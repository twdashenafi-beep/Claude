// Tasks proposed by other programs, held until a person says yes.
//
// Agents — scripts, assistants, anything that can write a file into the shared
// Drive folder — drop JSON files into DayFlow/agent-inbox/. Nothing in those
// files ever reaches the task list on its own. Each proposal waits in a
// Suggested list until it is accepted, which makes it an ordinary task, or
// dismissed, which keeps it on record and does nothing else.
//
// Everything here treats the file as hostile. Anyone who can write to that
// folder can claim to be any agent, so the name on a proposal is a label, not
// an identity: the tap is the safeguard. Every field is checked against a
// shape and a length, control and direction-changing characters are taken out
// of text, and links are https or nothing. A file that fails any check is
// rejected whole, with a reason, rather than half-applied — an agent that gets
// one item wrong finds out, instead of finding some of its work missing.
//
// What an agent can never do, by construction rather than by checking: delete
// a task, edit one, or finish one. A status suggestion is only accepted for a
// task the same agent proposed and a person accepted, and even then it changes
// nothing until it is accepted in turn.
//
// Pure: no storage, no React, no file system.

import { dueMoment } from './due.js';

// Not a project: the page the Suggested list is shown on, chosen from the same
// row of tabs as Finished.
export const SUGGESTED = '__suggested';

export const STATE_VERSION = 1;
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_PROPOSALS = 100;

export const NEW_TASK = 'new_task';
export const STATUS_SUGGESTION = 'status_suggestion';
export const SUGGESTABLE_STATUSES = ['done', 'open'];

export const PENDING = 'pending';
export const ACCEPTED = 'accepted';
export const DISMISSED = 'dismissed';

const LIMITS = {
  id: 120, title: 200, notes: 4000, owner: 80, deal: 120, agent: 60,
  source_url: 500, target_task_id: 120, evidence: 2000,
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// C0 and C1 controls, the bidirectional overrides and isolates that can make
// text read differently from what it says, and the zero-width characters that
// hide inside it. Newlines and tabs survive in fields that are allowed lines.
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

export function emptyState() {
  return { version: STATE_VERSION, suggestions: [] };
}

// A state read back from storage, made safe to use whatever it holds.
export function normaliseState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.suggestions)) return emptyState();
  return {
    version: STATE_VERSION,
    suggestions: raw.suggestions.filter(s => s && typeof s === 'object' && typeof s.key === 'string'),
  };
}

function plain(value, field, { lines = false } = {}) {
  if (typeof value !== 'string') return { error: `${field} must be text` };
  let text = value.replace(HIDDEN, '');
  text = lines ? text.replace(/\r\n?/g, '\n') : text.replace(/[\r\n\t]+/g, ' ');
  text = text.trim();
  if (text.length > LIMITS[field]) return { error: `${field} is longer than ${LIMITS[field]} characters` };
  return { value: text };
}

function required(raw, field, opts) {
  if (raw[field] === undefined || raw[field] === null) return { error: `${field} is missing` };
  const got = plain(raw[field], field, opts);
  if (got.error) return got;
  if (!got.value) return { error: `${field} is empty` };
  return got;
}

function optional(raw, field, opts) {
  if (raw[field] === undefined || raw[field] === null || raw[field] === '') return { value: '' };
  return plain(raw[field], field, opts);
}

function identifier(raw, field) {
  const got = required(raw, field);
  if (got.error) return got;
  if (!ID.test(got.value)) return { error: `${field} may only use letters, digits and . _ : -` };
  return got;
}

export function validDay(text) {
  const m = DAY.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d
    && y >= 2000 && y <= 2100;
}

// https only, and no user name or password in it: a link is something a person
// will tap, and those are the shapes that make a link lie about where it goes.
export function safeLink(text) {
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
  return url.toString();
}

// One proposal, checked field by field. Returns the cleaned proposal, holding
// only the fields this module knows, or the first thing wrong with it.
export function validateProposal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'is not an object' };

  const type = raw.type;
  if (type !== NEW_TASK && type !== STATUS_SUGGESTION) {
    return { error: `type must be "${NEW_TASK}" or "${STATUS_SUGGESTION}"` };
  }

  const out = { type };
  const take = (field, got) => {
    if (got.error) throw new Error(got.error);
    out[field] = got.value;
  };

  try {
    take('id', identifier(raw, 'id'));
    take('agent', required(raw, 'agent'));
    take('deal', required(raw, 'deal'));
    take('owner', required(raw, 'owner'));
    take('notes', optional(raw, 'notes', { lines: true }));

    const link = optional(raw, 'source_url');
    if (link.error) throw new Error(link.error);
    const safe = safeLink(link.value);
    if (safe === null) throw new Error('source_url must be an https:// link');
    out.source_url = safe;

    const due = optional(raw, 'due');
    if (due.error) throw new Error(due.error);
    if (due.value && !validDay(due.value)) throw new Error('due must be a real date written YYYY-MM-DD');
    out.due = due.value;

    if (type === NEW_TASK) {
      take('title', required(raw, 'title'));
    } else {
      take('title', optional(raw, 'title'));
      take('target_task_id', identifier(raw, 'target_task_id'));
      if (!SUGGESTABLE_STATUSES.includes(raw.suggested_status)) {
        throw new Error(`suggested_status must be ${SUGGESTABLE_STATUSES.map(s => `"${s}"`).join(' or ')}`);
      }
      out.suggested_status = raw.suggested_status;
      take('evidence', required(raw, 'evidence', { lines: true }));
    }
  } catch (err) {
    return { error: err.message };
  }
  return { proposal: out };
}

// A whole file: one proposal, a list of them, or { "proposals": [...] }.
export function parseInboxFile(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'The file could not be read as text.' };
  if (text.length > MAX_FILE_BYTES) return { ok: false, reason: `The file is larger than ${MAX_FILE_BYTES / 1024} KB.` };

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    return { ok: false, reason: `The file is not valid JSON (${String(err.message).slice(0, 120)}).` };
  }

  let items;
  if (Array.isArray(parsed)) items = parsed;
  else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.proposals)) items = parsed.proposals;
  else if (parsed && typeof parsed === 'object' && 'type' in parsed) items = [parsed];
  else return { ok: false, reason: 'The file must hold a proposal, a list of proposals, or { "proposals": [...] }.' };

  if (items.length === 0) return { ok: false, reason: 'The file holds no proposals.' };
  if (items.length > MAX_PROPOSALS) return { ok: false, reason: `The file holds more than ${MAX_PROPOSALS} proposals.` };

  const proposals = [];
  const problems = [];
  items.forEach((item, i) => {
    const got = validateProposal(item);
    if (got.error) problems.push(`Proposal ${i + 1}: ${got.error}.`);
    else proposals.push(got.proposal);
  });
  if (problems.length) return { ok: false, reason: problems.join('\n') };
  return { ok: true, proposals };
}

export function keyOf(agent, id) {
  return `${agent}\u0000${id}`;
}

export function findSuggestion(state, key) {
  return state.suggestions.find(s => s.key === key) || null;
}

// The task an accepted proposal became, if it is still there and still marked
// as that agent's. Matching on the stored marker as well as the id means a task
// that was a person's own can never be reached, whatever id a file names.
export function agentTask(tasks, agent, proposalId) {
  return (tasks || []).find(t =>
    t && t.agent && t.agent.name === agent && t.agent.proposalId === proposalId) || null;
}

// Takes a parsed file into the state. All or nothing: if any status suggestion
// points somewhere it may not, the file is rejected and the state is unchanged.
// Proposals already seen — from this agent, with this id — are skipped, which is
// what makes dropping the same file twice harmless.
export function applyProposals(state, proposals, { tasks = [], file = '', now = new Date() } = {}) {
  const seen = new Set(state.suggestions.map(s => s.key));
  const fresh = [];
  const problems = [];
  let duplicates = 0;

  proposals.forEach((p, i) => {
    const key = keyOf(p.agent, p.id);
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }
    if (p.type === STATUS_SUGGESTION) {
      const target = findSuggestion(state, keyOf(p.agent, p.target_task_id));
      if (!target || target.type !== NEW_TASK) {
        problems.push(`Proposal ${i + 1}: target_task_id "${p.target_task_id}" is not a task ${p.agent} proposed.`);
        return;
      }
      if (target.status !== ACCEPTED || !agentTask(tasks, p.agent, p.target_task_id)) {
        problems.push(`Proposal ${i + 1}: target_task_id "${p.target_task_id}" has not been accepted, or is no longer on the page, so it has no status to change.`);
        return;
      }
    }
    seen.add(key);
    fresh.push({
      key,
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
      status: PENDING,
      receivedAt: now.toISOString(),
      decidedAt: null,
      file: String(file).slice(0, 150),
      taskId: null,
    });
  });

  if (problems.length) return { ok: false, reason: problems.join('\n'), state, added: 0, duplicates };
  return {
    ok: true,
    state: { ...state, suggestions: [...state.suggestions, ...fresh] },
    added: fresh.length,
    duplicates,
  };
}

export function pendingOf(state) {
  return state.suggestions.filter(s => s.status === PENDING);
}

function isMe(owner) {
  return String(owner).trim().toLowerCase() === 'me';
}

// Noon, local: a date-only due date then reads as the same day wherever the
// device is, which midnight does not.
export function dueDateFor(day) {
  if (!day || !validDay(day)) return undefined;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

// What addTask is given when a new_task suggestion is accepted. Owned by "me",
// it is a To Do; owned by anyone else, it is something they owe, which is what
// the Owe Me column is for.
export function taskDataFor(suggestion) {
  const mine = isMe(suggestion.owner);
  const data = {
    title: suggestion.title,
    notes: suggestion.notes || '',
    taskType: mine ? 'todo' : 'done_for_me',
    section: mine ? 'todo' : 'owe_me',
    owePerson: mine ? '' : suggestion.owner,
    agent: {
      name: suggestion.agent,
      deal: suggestion.deal,
      sourceUrl: suggestion.sourceUrl || '',
      proposalId: suggestion.id,
      owner: suggestion.owner,
    },
  };
  const due = dueDateFor(suggestion.due);
  if (due) data.dueDate = due;
  return data;
}

// What accepting a status suggestion would do, or why it cannot. Decided at the
// moment of the tap, against the list as it is then: the task may have been
// finished, archived or deleted since the suggestion arrived.
export function statusChangeFor(suggestion, tasks) {
  if (!suggestion || suggestion.type !== STATUS_SUGGESTION) return { error: 'Not a status suggestion.' };
  const task = agentTask(tasks, suggestion.agent, suggestion.targetId);
  if (!task) return { error: 'The task it refers to is no longer on the page.' };
  const completed = suggestion.suggestedStatus === 'done';
  if (!!task.completed === completed) return { taskId: task.id, completed, already: true };
  return { taskId: task.id, completed };
}

function decide(state, key, patch) {
  return {
    ...state,
    suggestions: state.suggestions.map(s => (s.key === key ? { ...s, ...patch } : s)),
  };
}

export function markAccepted(state, key, { taskId = null, now = new Date() } = {}) {
  return decide(state, key, { status: ACCEPTED, decidedAt: now.toISOString(), taskId });
}

// Kept, not removed: a dismissed proposal is still a record of what was
// proposed, and still how a duplicate of it is recognised.
export function markDismissed(state, key, { now = new Date() } = {}) {
  return decide(state, key, { status: DISMISSED, decidedAt: now.toISOString() });
}

// The words a task row shows for a task that came from an agent.
export function agentLabel(task) {
  const a = task && task.agent;
  if (!a || typeof a !== 'object' || typeof a.name !== 'string') return null;
  return a.deal ? `from ${a.name} · ${a.deal}` : `from ${a.name}`;
}

// ── The export ──────────────────────────────────────────────────────────────
//
// A second file, beside the backup rather than instead of it, in its own named
// format. The backup keeps every field as stored so it can be restored; this one
// is for reading — by a person, or by the agents that proposed the work and want
// to know what became of it.

export const EXPORT_FORMAT = 'dayflow-agent-export';
export const EXPORT_VERSION = 1;

function localDay(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function exportedTask(task, projects) {
  const moment = dueMoment(task);
  const project = task.projectId ? projects.find(p => p.id === task.projectId) : null;
  const out = {
    id: task.id,
    title: task.title || '',
    notes: task.notes || '',
    column: task.taskType === 'done_for_me' ? 'owe_me' : 'todo',
    owe_person: task.owePerson || '',
    project: project ? project.name : null,
    priority: task.priority || 'medium',
    due: moment ? localDay(moment.at) : null,
    due_time: task.dueTime || '',
    completed: !!task.completed,
    completed_at: task.completedAt || null,
    archived: !!task.archivedAt,
    created_at: task.createdAt || null,
    updated_at: task.updatedAt || null,
    agent: null,
  };
  if (task.agent && typeof task.agent === 'object') {
    out.agent = {
      name: task.agent.name,
      deal: task.agent.deal,
      source_url: task.agent.sourceUrl || '',
      proposal_id: task.agent.proposalId,
      owner: task.agent.owner,
      status: task.completed ? 'completed' : 'accepted',
    };
  }
  return out;
}

function exportedSuggestion(s, tasks) {
  let status = s.status === PENDING ? 'suggested' : s.status;
  if (s.type === NEW_TASK && s.status === ACCEPTED) {
    const task = agentTask(tasks, s.agent, s.id);
    if (task && task.completed) status = 'completed';
  }
  return {
    agent: s.agent,
    id: s.id,
    type: s.type,
    deal: s.deal,
    owner: s.owner,
    title: s.title,
    due: s.due || null,
    source_url: s.sourceUrl || '',
    target_task_id: s.targetId || null,
    suggested_status: s.suggestedStatus || null,
    evidence: s.evidence || null,
    status,
    task_id: s.taskId || null,
    received_at: s.receivedAt,
    decided_at: s.decidedAt,
  };
}

export function buildAgentExport({ tasks = [], projects = [], state = emptyState(), now = new Date() } = {}) {
  const real = tasks.filter(t => t && t.kind !== 'project');
  return {
    app: 'DayFlow',
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    whatThisIs:
      'Every DayFlow task, written automatically whenever tasks change, for agents and people to read. ' +
      'Not encrypted. Restoring uses the separate backup file, not this one. Voice notes are not included.',
    tasks: real.map(t => exportedTask(t, projects)),
    suggestions: state.suggestions.map(s => exportedSuggestion(s, real)),
  };
}
