// Suggestions, shared between one person's devices.
//
// Only the Mac app can read the Drive folder agents write to, so only the Mac
// ever learns of a proposal first-hand. This is what lets a phone show it, and
// decide it: each suggestion travels as one encrypted row, in a table of its
// own, and is merged on arrival by the rules below.
//
// A table of its own, not the task table. A device on an older build shows any
// task row it can decrypt as a task — which is the one thing a suggestion must
// never become without a tap.
//
// What arrives is treated as the file was: checked field by field before it is
// believed. The row was encrypted with this person's key, so it is very likely
// their own Mac's work — but "very likely" is not the standard this feature is
// held to, and a check that costs nothing is cheaper than being wrong.
//
// Pure: no network, no storage, no clock.

import CryptoJS from 'crypto-js';
import {
  validateProposal, keyOf, NEW_TASK, STATUS_SUGGESTION, PENDING, ACCEPTED, DISMISSED,
} from './agentInbox.js';

const STATUSES = [PENDING, ACCEPTED, DISMISSED];

// The row's name on the server. The key itself is the agent's name and the
// proposal's id, both of which say something; an HMAC under the data key says
// nothing to anyone without it, and is the same on every device that has it.
export function rowIdFor(key, dataKey) {
  if (!dataKey) throw new Error('Cannot name a row without a key');
  return `s_${CryptoJS.HmacSHA256(key, dataKey).toString(CryptoJS.enc.Hex)}`;
}

// The id of the task an accepted suggestion becomes. Fixed by the suggestion,
// so two devices that both accept it while out of touch make the same task
// twice over, which the task merge already knows how to make one of.
export function taskIdFor(key, dataKey) {
  return `agent_${rowIdFor(key, dataKey).slice(2, 34)}`;
}

function stamp(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

// A suggestion as it came off the wire, rebuilt from only the fields this app
// knows, each one put through the same checks a file gets. Null if it does not
// survive them.
export function cleanSuggestion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!STATUSES.includes(raw.status)) return null;

  const asFile = {
    type: raw.type, id: raw.id, agent: raw.agent, deal: raw.deal, owner: raw.owner,
    title: raw.title, notes: raw.notes, due: raw.due, source_url: raw.sourceUrl,
  };
  if (raw.type === STATUS_SUGGESTION) {
    asFile.target_task_id = raw.targetId;
    asFile.suggested_status = raw.suggestedStatus;
    asFile.evidence = raw.evidence;
  }
  const got = validateProposal(asFile);
  if (got.error) return null;
  const p = got.proposal;

  const receivedAt = stamp(raw.receivedAt);
  if (!receivedAt) return null;
  const decidedAt = raw.status === PENDING ? null : stamp(raw.decidedAt);
  if (raw.status !== PENDING && !decidedAt) return null;

  return {
    key: keyOf(p.agent, p.id),
    type: p.type,
    id: p.id,
    agent: p.agent,
    deal: p.deal,
    owner: p.owner,
    title: p.title,
    notes: p.notes,
    due: p.due,
    sourceUrl: p.source_url,
    targetId: p.target_task_id || '',
    suggestedStatus: p.suggested_status || '',
    evidence: p.evidence || '',
    status: raw.status,
    receivedAt,
    decidedAt,
    file: typeof raw.file === 'string' ? raw.file.slice(0, 150) : '',
    taskId: raw.status === ACCEPTED && typeof raw.taskId === 'string' ? raw.taskId.slice(0, 120) : null,
  };
}

// Which of two copies of one suggestion stands.
//
// A decision beats waiting, always: a phone that was in a drawer for a week
// still holds the proposal as waiting, and must not bring it back. Between two
// decisions the earlier one stands — it is the one a person made first, and the
// second was made by somebody who had not yet seen it. Ties fall the same way
// on every device, so they cannot disagree for ever.
function stands(a, b) {
  const aDecided = a.status !== PENDING;
  const bDecided = b.status !== PENDING;
  if (aDecided !== bDecided) return aDecided ? a : b;
  if (!aDecided) return a;
  const at = Date.parse(a.decidedAt) || 0;
  const bt = Date.parse(b.decidedAt) || 0;
  if (at !== bt) return at < bt ? a : b;
  if (a.status !== b.status) return a.status === ACCEPTED ? a : b;
  return a;
}

function same(a, b) {
  return a.status === b.status && a.decidedAt === b.decidedAt && (a.taskId || null) === (b.taskId || null);
}

// Merge what the server holds into what this device holds. Returns the merged
// list, whether it differs from the local one, and the keys whose rows the
// server needs — so one pass settles both directions, as the task merge does.
//
// A row that cannot be decrypted, does not pass the checks, or is filed under a
// name that is not its own is skipped. One bad row must not stop the rest.
export function mergeSuggestions({ local, remoteRows, decryptRow, rowId }) {
  const merged = new Map((local || []).map(s => [s.key, s]));
  const remote = new Map();

  for (const row of (remoteRows || [])) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string') continue;
    let raw = null;
    try {
      raw = decryptRow(row.ciphertext);
    } catch {
      raw = null;
    }
    const clean = cleanSuggestion(raw);
    if (!clean || rowId(clean.key) !== row.id) continue;
    remote.set(clean.key, clean);
  }

  let changed = false;
  const pushKeys = [];

  for (const [key, theirs] of remote) {
    const mine = merged.get(key);
    if (!mine) {
      merged.set(key, theirs);
      changed = true;
      continue;
    }
    const winner = stands(mine, theirs);
    if (winner === theirs && !same(mine, theirs)) {
      // The words stay as this device first read them; only the decision moves.
      merged.set(key, { ...mine, status: theirs.status, decidedAt: theirs.decidedAt, taskId: theirs.taskId });
      changed = true;
    } else if (winner === mine && !same(mine, theirs)) {
      pushKeys.push(key);
    }
  }
  for (const key of merged.keys()) {
    if (!remote.has(key)) pushKeys.push(key);
  }

  // In the order they were received, wherever they were received.
  const suggestions = [...merged.values()].sort(
    (a, b) => (Date.parse(a.receivedAt) || 0) - (Date.parse(b.receivedAt) || 0));

  return { suggestions, changed, pushKeys };
}

export { NEW_TASK };
