// Suggestions shared between devices: what stands when two copies disagree,
// and what is believed of a row that arrives. Run with `npm test`.

import {
  mergeSuggestions, cleanSuggestion, rowIdFor, taskIdFor,
} from '../src/services/suggestionSync.js';
import { applyProposals, emptyState, markAccepted, markDismissed, keyOf } from '../src/services/agentInbox.js';
import { encrypt, decrypt } from '../src/services/encryption.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const KEY = 'a-data-key-for-tests';
const at = iso => new Date(iso);
const proposal = (id, extra = {}) => ({
  type: 'new_task', id, agent: 'deal-bot', deal: 'Djibouti diesel', owner: 'me',
  title: `Task ${id}`, notes: '', due: '', source_url: '', ...extra,
});
const collected = (...ids) => applyProposals(emptyState(), ids.map(id => proposal(id)), { now: at('2026-11-27T08:00:00Z') }).state;

const rowId = key => rowIdFor(key, KEY);
const rowsOf = suggestions => suggestions.map(s => ({
  id: rowId(s.key), ciphertext: encrypt(JSON.stringify(s), KEY), updatedAt: s.decidedAt || s.receivedAt,
}));
const decryptRow = c => { const t = decrypt(c, KEY); return t ? JSON.parse(t) : null; };
const merge = (local, remoteRows) => mergeSuggestions({ local, remoteRows, decryptRow, rowId });
const k = id => keyOf('deal-bot', id);
const find = (list, id) => list.find(s => s.key === k(id));

// ── What the server is told ──
{
  const id = rowId(k('a'));
  ok('a row is named by something that says nothing', /^s_[0-9a-f]{64}$/.test(id) && !id.includes('deal-bot'), id);
  ok('the same on every device with the key', id === rowIdFor(k('a'), KEY));
  ok('and different under another key', id !== rowIdFor(k('a'), 'another-key'));
  ok('a row cannot be named without a key', (() => { try { rowIdFor(k('a'), ''); return false; } catch { return true; } })());
  ok('the task an acceptance makes has one id everywhere', taskIdFor(k('a'), KEY) === taskIdFor(k('a'), KEY)
    && taskIdFor(k('a'), KEY) !== taskIdFor(k('b'), KEY) && !taskIdFor(k('a'), KEY).includes('deal-bot'));
  const cipher = rowsOf(collected('a').suggestions)[0].ciphertext;
  ok('the row itself is ciphertext', !cipher.includes('deal-bot') && !cipher.includes('Task a'));
}

// ── The Mac collects, the phone learns ──
{
  const mac = collected('a', 'b');
  const first = merge(mac.suggestions, []);
  ok('what the server has not seen is pushed', first.pushKeys.length === 2 && !first.changed);

  const phone = merge([], rowsOf(mac.suggestions));
  ok('a device with nothing receives both, waiting', phone.changed && phone.suggestions.length === 2
    && phone.suggestions.every(s => s.status === 'pending'));
  ok('and has nothing to send back', phone.pushKeys.length === 0);

  const again = merge(phone.suggestions, rowsOf(mac.suggestions));
  ok('a second sync with nothing new changes nothing and sends nothing', !again.changed && again.pushKeys.length === 0);
}

// ── A decision travels, and is never undone ──
{
  const mac = collected('a', 'b');
  const phoneAccepted = markAccepted(mac, k('a'), { taskId: 'agent_x', now: at('2026-11-27T09:00:00Z') });

  const up = merge(phoneAccepted.suggestions, rowsOf(mac.suggestions));
  ok('a decision made here is pushed', up.pushKeys.length === 1 && up.pushKeys[0] === k('a') && !up.changed);

  const down = merge(mac.suggestions, rowsOf(phoneAccepted.suggestions));
  ok('a decision made elsewhere arrives', down.changed && find(down.suggestions, 'a').status === 'accepted'
    && find(down.suggestions, 'a').taskId === 'agent_x');
  ok('and leaves the other suggestion waiting', find(down.suggestions, 'b').status === 'pending');

  // A phone in a drawer for a week still holds it as waiting.
  const stale = merge(phoneAccepted.suggestions, rowsOf(mac.suggestions));
  ok('a stale waiting copy does not bring a decided one back', find(stale.suggestions, 'a').status === 'accepted');
}

// ── Two decisions ──
{
  const mac = collected('a');
  const dismissedFirst = markDismissed(mac, k('a'), { now: at('2026-11-27T09:00:00Z') });
  const acceptedLater = markAccepted(mac, k('a'), { taskId: 'agent_x', now: at('2026-11-27T09:05:00Z') });

  const one = merge(acceptedLater.suggestions, rowsOf(dismissedFirst.suggestions));
  const two = merge(dismissedFirst.suggestions, rowsOf(acceptedLater.suggestions));
  ok('the earlier of two decisions stands', find(one.suggestions, 'a').status === 'dismissed');
  ok('on both devices alike', find(two.suggestions, 'a').status === 'dismissed' && two.pushKeys.includes(k('a')));

  const sameMoment = at('2026-11-27T09:00:00Z');
  const a = markAccepted(mac, k('a'), { taskId: 'agent_x', now: sameMoment });
  const d = markDismissed(mac, k('a'), { now: sameMoment });
  ok('a tie falls the same way whichever device looks',
    find(merge(a.suggestions, rowsOf(d.suggestions)).suggestions, 'a').status
      === find(merge(d.suggestions, rowsOf(a.suggestions)).suggestions, 'a').status);
}

// ── What arrives is not believed until it is checked ──
{
  const good = collected('a').suggestions[0];
  const row = raw => [{ id: rowId(raw.key || k('a')), ciphertext: encrypt(JSON.stringify(raw), KEY), updatedAt: '2026-11-27T08:00:00Z' }];

  ok('a well-formed suggestion survives the check unchanged', JSON.stringify(cleanSuggestion(good)) === JSON.stringify(good));
  ok('an unknown status is refused', cleanSuggestion({ ...good, status: 'done' }) === null);
  ok('a decided one without a date is refused', cleanSuggestion({ ...good, status: 'accepted', decidedAt: null }) === null);
  ok('a link that is not https is refused', cleanSuggestion({ ...good, sourceUrl: 'javascript:alert(1)' }) === null);
  ok('an over-long title is refused', cleanSuggestion({ ...good, title: 'x'.repeat(201) }) === null);
  ok('a waiting one cannot carry a task id', cleanSuggestion({ ...good, taskId: 'someone-elses-task' }).taskId === null);
  ok('fields this app does not know are dropped', !('completed' in cleanSuggestion({ ...good, completed: true })));
  ok('hidden characters are taken out of text',
    cleanSuggestion({ ...good, title: 'Pay ‮eciovni' }).title === 'Pay eciovni');

  ok('a row that does not pass adds nothing', merge([], row({ ...good, status: 'done' })).suggestions.length === 0);
  ok('nor one that is not an object', merge([], row('just text')).suggestions.length === 0);
  ok('nor one filed under a name that is not its own',
    merge([], [{ ...row(good)[0], id: rowId(k('other')) }]).suggestions.length === 0);
  ok('nor one this key cannot read',
    merge([], [{ id: rowId(k('a')), ciphertext: encrypt(JSON.stringify(good), 'another-key'), updatedAt: 'x' }]).suggestions.length === 0);
  ok('a decryptRow that throws is one bad row, not the end of the merge',
    mergeSuggestions({ local: [], remoteRows: [{ id: 'x', ciphertext: 'y' }, ...row(good)],
      decryptRow: c => { if (c === 'y') throw new Error('boom'); return decryptRow(c); }, rowId }).suggestions.length === 1);
  ok('rows that are not rows are skipped', merge([], [null, 7, { id: 5 }, ...row(good)]).suggestions.length === 1);
  ok('no rows at all is not an error', merge(collected('a').suggestions, null).suggestions.length === 1);
}

// ── A status suggestion travels too ──
{
  const status = {
    key: keyOf('deal-bot', 'a-done'), type: 'status_suggestion', id: 'a-done', agent: 'deal-bot', deal: 'Djibouti diesel',
    owner: 'me', title: '', notes: '', due: '', sourceUrl: '', targetId: 'a', suggestedStatus: 'done',
    evidence: 'Confirmed by email.', status: 'pending', receivedAt: '2026-11-27T10:00:00.000Z', decidedAt: null, file: 'f.json', taskId: null,
  };
  const got = merge([], rowsOf([status])).suggestions[0];
  ok('with its target, status and evidence', got && got.targetId === 'a' && got.suggestedStatus === 'done' && got.evidence === 'Confirmed by email.');
  ok('and is refused without evidence', cleanSuggestion({ ...status, evidence: '' }) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
