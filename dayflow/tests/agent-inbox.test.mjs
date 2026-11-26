// The agent inbox: files that propose tasks, and the rules that keep them
// proposals until a person says otherwise. Pure logic. Run with `npm test`.

import {
  parseInboxFile, validateProposal, applyProposals, emptyState, normaliseState, keyOf,
  findSuggestion, pendingOf, taskDataFor, statusChangeFor, markAccepted, markDismissed,
  buildAgentExport, dueDateFor, safeLink,
  ACCEPTED, DISMISSED, PENDING, MAX_PROPOSALS, MAX_FILE_BYTES,
} from '../src/services/agentInbox.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const NOW = new Date('2026-11-26T09:00:00Z');
const task = (over = {}) => ({
  type: 'new_task', id: 'deal-42-call', title: 'Call the refinery about Q1 volumes',
  notes: 'Ask about the Djibouti slot.', due: '2026-12-03', owner: 'me',
  deal: 'Djibouti diesel', agent: 'deal-bot', source_url: 'https://example.com/thread/42', ...over,
});
const status = (over = {}) => ({
  type: 'status_suggestion', id: 'deal-42-call-done', owner: 'me', deal: 'Djibouti diesel',
  agent: 'deal-bot', target_task_id: 'deal-42-call', suggested_status: 'done',
  evidence: 'Email from the refinery on 25 Nov confirms the call happened.', ...over,
});
const file = v => JSON.stringify(v);

// ── Valid files ─────────────────────────────────────────────────────────────

{
  const got = parseInboxFile(file(task()));
  ok('a single proposal is a valid file', got.ok && got.proposals.length === 1);
  ok('its fields survive', got.ok && got.proposals[0].title === 'Call the refinery about Q1 volumes'
    && got.proposals[0].due === '2026-12-03' && got.proposals[0].source_url === 'https://example.com/thread/42');
}
{
  const got = parseInboxFile(file([task(), task({ id: 'two', title: 'Second' })]));
  ok('a list of proposals is a valid file', got.ok && got.proposals.length === 2);
}
{
  const got = parseInboxFile(file({ proposals: [task()] }));
  ok('{ proposals: [...] } is a valid file', got.ok && got.proposals.length === 1);
}
{
  const got = parseInboxFile('﻿' + file(task()));
  ok('a byte-order mark at the start is tolerated', got.ok);
}
{
  const got = parseInboxFile(file(task({ notes: undefined, due: undefined, source_url: undefined })));
  ok('notes, due and source_url are optional', got.ok && got.proposals[0].due === '' && got.proposals[0].source_url === '');
}
{
  const got = parseInboxFile(file(task({ extra: 'ignored', __proto__: { polluted: true } })));
  ok('unknown fields are dropped, not kept', got.ok && !('extra' in got.proposals[0]) && !('polluted' in got.proposals[0]));
}

// ── Plain text only ─────────────────────────────────────────────────────────

{
  const got = parseInboxFile(file(task({ title: 'Pay‮txt.exe\u0000 now​', notes: '<b>bold</b>\r\nline two' })));
  const p = got.proposals[0];
  ok('control, zero-width and direction-override characters are removed', p.title === 'Paytxt.exe now', JSON.stringify(p.title));
  ok('markup stays as literal text', p.notes === '<b>bold</b>\nline two', JSON.stringify(p.notes));
}
{
  const got = parseInboxFile(file(task({ title: 'one\ntwo\tthree' })));
  ok('line breaks in a title fold to spaces', got.proposals[0].title === 'one two three');
}

// ── Invalid files ───────────────────────────────────────────────────────────

const rejected = (label, text, mention) => {
  const got = parseInboxFile(text);
  ok(label, !got.ok && (!mention || got.reason.includes(mention)), got.reason || 'accepted');
};
rejected('not JSON is rejected with a reason', '{ not json', 'not valid JSON');
rejected('an empty list is rejected', file([]), 'no proposals');
rejected('a bare string is rejected', file('hello'), 'must hold');
rejected('too many proposals are rejected', file(Array.from({ length: MAX_PROPOSALS + 1 }, (_, i) => task({ id: `t${i}` }))), 'more than');
rejected('a file over the size limit is rejected', ' '.repeat(MAX_FILE_BYTES + 1), 'larger than');
rejected('an unknown type is rejected', file(task({ type: 'delete_task' })), 'type must be');
rejected('a missing agent is rejected', file(task({ agent: undefined })), 'agent is missing');
rejected('a blank deal is rejected', file(task({ deal: '   ' })), 'deal is empty');
rejected('a missing title on a new task is rejected', file(task({ title: undefined })), 'title is missing');
rejected('a title that is not text is rejected', file(task({ title: { $gt: '' } })), 'title must be text');
rejected('an over-long title is rejected', file(task({ title: 'x'.repeat(201) })), 'longer than 200');
rejected('an id with slashes is rejected', file(task({ id: '../../etc' })), 'id may only use');
rejected('a non-date due is rejected', file(task({ due: 'next Tuesday' })), 'due must be');
rejected('an impossible date is rejected', file(task({ due: '2026-02-30' })), 'due must be');
rejected('a javascript: link is rejected', file(task({ source_url: 'javascript:alert(1)' })), 'https://');
rejected('a plain http link is rejected', file(task({ source_url: 'http://example.com' })), 'https://');
rejected('a link with a password in it is rejected', file(task({ source_url: 'https://user:pw@example.com' })), 'https://');
rejected('one bad proposal rejects the whole file', file([task(), task({ id: 'b', due: 'soon' })]), 'Proposal 2');
rejected('a status suggestion without evidence is rejected', file(status({ evidence: '' })), 'evidence is empty');
rejected('a status suggestion with an unknown status is rejected', file(status({ suggested_status: 'deleted' })), 'suggested_status');
rejected('a status suggestion without a target is rejected', file(status({ target_task_id: undefined })), 'target_task_id is missing');

ok('safeLink keeps a normal https link', safeLink('https://example.com/a?b=1') === 'https://example.com/a?b=1');
ok('validateProposal rejects null without throwing', !!validateProposal(null).error);

// ── Applying, and duplicates ────────────────────────────────────────────────

let state = emptyState();
{
  const first = applyProposals(state, parseInboxFile(file([task(), task({ id: 'other' })])).proposals, { file: 'a.json', now: NOW });
  ok('proposals become pending suggestions', first.ok && first.added === 2 && pendingOf(first.state).length === 2);
  state = first.state;

  const again = applyProposals(state, parseInboxFile(file(task())).proposals, { file: 'b.json', now: NOW });
  ok('the same agent and id again is a duplicate, skipped', again.ok && again.added === 0 && again.duplicates === 1);
  ok('a duplicate leaves the state as it was', again.state.suggestions.length === 2);

  const inOne = applyProposals(emptyState(), parseInboxFile(file([task(), task()])).proposals, { now: NOW });
  ok('a duplicate inside one file is skipped too', inOne.ok && inOne.added === 1 && inOne.duplicates === 1);

  const otherAgent = applyProposals(state, parseInboxFile(file(task({ agent: 'mail-bot' }))).proposals, { now: NOW });
  ok('the same id from another agent is a different proposal', otherAgent.added === 1);
}

// ── Accepting and dismissing ────────────────────────────────────────────────

const key = keyOf('deal-bot', 'deal-42-call');
{
  const s = findSuggestion(state, key);
  const data = taskDataFor(s);
  ok('owner "me" becomes a To Do', data.taskType === 'todo' && data.owePerson === '');
  ok('the agent, deal and link travel with the task',
    data.agent.name === 'deal-bot' && data.agent.deal === 'Djibouti diesel'
    && data.agent.sourceUrl === 'https://example.com/thread/42' && data.agent.proposalId === 'deal-42-call');
  ok('the due date is that day, at noon local', new Date(data.dueDate).getDate() === 3 && new Date(data.dueDate).getHours() === 12);

  const owed = taskDataFor({ ...s, owner: 'Abebe (EPSE)' });
  ok('anyone else as owner becomes Owe Me, with them as the person', owed.taskType === 'done_for_me' && owed.owePerson === 'Abebe (EPSE)');
  ok('no due date means none is invented', taskDataFor({ ...s, due: '' }).dueDate === undefined);
  ok('dueDateFor refuses a bad date', dueDateFor('2026-13-01') === undefined);
}

let tasks = [{ id: 'mine-1', title: 'My own task', completed: false }];
{
  const accepted = markAccepted(state, key, { taskId: 'task-a', now: NOW });
  ok('accepting marks it accepted with the task it became',
    findSuggestion(accepted, key).status === ACCEPTED && findSuggestion(accepted, key).taskId === 'task-a');
  ok('accepting one leaves the other pending', pendingOf(accepted).length === 1);
  state = accepted;
  tasks = [...tasks, { id: 'task-a', title: 'Call the refinery', completed: false, agent: taskDataFor(findSuggestion(state, key)).agent }];

  const dismissed = markDismissed(state, keyOf('deal-bot', 'other'), { now: NOW });
  const d = findSuggestion(dismissed, keyOf('deal-bot', 'other'));
  ok('dismissing keeps the record, marked dismissed', d && d.status === DISMISSED && d.decidedAt);
  state = dismissed;

  const back = applyProposals(state, parseInboxFile(file(task({ id: 'other' }))).proposals, { now: NOW });
  ok('a dismissed proposal sent again stays dismissed', back.added === 0 && findSuggestion(back.state, keyOf('deal-bot', 'other')).status === DISMISSED);
}

// ── Status suggestions ──────────────────────────────────────────────────────

{
  const got = applyProposals(state, parseInboxFile(file(status())).proposals, { tasks, now: NOW });
  ok('a status suggestion on an accepted task of the same agent is taken', got.ok && got.added === 1);
  const s = findSuggestion(got.state, keyOf('deal-bot', 'deal-42-call-done'));
  ok('it is pending, with its evidence', s.status === PENDING && s.evidence.startsWith('Email from the refinery'));

  const change = statusChangeFor(s, tasks);
  ok('accepting it would finish that task and only that task', change.taskId === 'task-a' && change.completed === true && !change.already);

  const done = statusChangeFor(s, tasks.map(t => (t.id === 'task-a' ? { ...t, completed: true } : t)));
  ok('if the task is already done, accepting changes nothing', done.already === true);

  const gone = statusChangeFor(s, tasks.filter(t => t.id !== 'task-a'));
  ok('if the task has gone, accepting says so', !!gone.error);

  const reopen = applyProposals(got.state, parseInboxFile(file(status({ id: 'reopen', suggested_status: 'open' }))).proposals, { tasks, now: NOW });
  ok('"open" is a status an agent may suggest', reopen.ok && reopen.added === 1);

  state = got.state;
}
{
  const pendingTarget = applyProposals(emptyState(), parseInboxFile(file([task()])).proposals, { now: NOW }).state;
  const got = applyProposals(pendingTarget, parseInboxFile(file(status())).proposals, { tasks: [], now: NOW });
  ok('a status suggestion on a task not yet accepted is rejected', !got.ok && got.reason.includes('has not been accepted'));
}
{
  const got = applyProposals(state, parseInboxFile(file(status({ agent: 'mail-bot', id: 'x' }))).proposals, { tasks, now: NOW });
  ok('another agent cannot suggest a status for this agent\'s task', !got.ok && got.reason.includes('is not a task mail-bot proposed'));
}
{
  const got = applyProposals(state, parseInboxFile(file(status({ id: 'y', target_task_id: 'mine-1' }))).proposals, { tasks, now: NOW });
  ok('a status suggestion cannot reach a task I created myself', !got.ok);
}
{
  const forged = [...tasks, { id: 'mine-2', title: 'Mine', agent: null }];
  const s = { type: 'status_suggestion', agent: 'deal-bot', targetId: 'mine-2', suggestedStatus: 'done' };
  ok('statusChangeFor will not touch a task without that agent\'s marker', !!statusChangeFor(s, forged).error);
}
{
  const mixed = applyProposals(state, parseInboxFile(file([task({ id: 'fine' }), status({ id: 'z', target_task_id: 'nope' })])).proposals, { tasks, now: NOW });
  ok('one bad status suggestion rejects the whole file, and nothing is added', !mixed.ok && mixed.state === state);
}

// ── Storage round trip ──────────────────────────────────────────────────────

ok('normaliseState survives garbage', normaliseState('nonsense').suggestions.length === 0
  && normaliseState({ suggestions: [null, 3, { key: 'k' }] }).suggestions.length === 1);

// ── The export ──────────────────────────────────────────────────────────────

{
  const all = [
    { id: 'p1', kind: 'project', name: 'Deals' },
    { id: 'mine-1', title: 'My own task', completed: false, createdAt: '2026-11-01T00:00:00Z', dueDate: '2026-11-01T00:00:00Z' },
    { ...tasks[1], completed: true, completedAt: NOW.toISOString(), projectId: 'p1' },
  ];
  const out = buildAgentExport({ tasks: all, projects: [all[0]], state, now: NOW });
  ok('the export is its own named format', out.format === 'dayflow-agent-export' && out.version === 1);
  ok('projects are not listed as tasks', out.tasks.length === 2);
  ok('my own task has no agent', out.tasks.find(t => t.id === 'mine-1').agent === null);
  ok('an undated task exports no due date', out.tasks.find(t => t.id === 'mine-1').due === null);
  const agentRow = out.tasks.find(t => t.id === 'task-a');
  ok('a finished agent task reads completed', agentRow.agent.status === 'completed' && agentRow.project === 'Deals');
  const bySug = id => out.suggestions.find(s => s.id === id);
  ok('the accepted-then-finished proposal reads completed', bySug('deal-42-call').status === 'completed');
  ok('the dismissed proposal reads dismissed', bySug('other').status === 'dismissed');
  ok('the waiting status suggestion reads suggested, with its evidence',
    bySug('deal-42-call-done').status === 'suggested' && bySug('deal-42-call-done').evidence.length > 10);
  ok('it is plain JSON', typeof JSON.stringify(out) === 'string');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
