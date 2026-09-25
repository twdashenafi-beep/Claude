// Reading a copy back in.
//
// The other half of the export, and the half with teeth: it runs against a
// vault that already has things in it, and the worst outcome is not a failed
// import — it is a successful one that quietly loses work.
//
// So there is one rule above all others, and everything here is arranged
// around it: **nothing in the vault is ever removed**. A task that is in the
// vault and not in the file stays exactly as it is. An import can add, and it
// can bring a task forward to a newer version of itself, and that is all it can
// do. Whatever happens, the worst case is a few tasks you did not want, which
// you can delete — rather than a few you did, which you cannot get back.
//
// What is decided here and applied elsewhere: this module only says what would
// happen, which is what lets the app show it to somebody before it does.
//
// Pure: no storage, no React, no clock of its own.

import { FORMAT } from './backup.js';

// What a file has to be before any of it is believed.
export function readBackup(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'That file is empty.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not a DayFlow copy — it is not even JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'That is not a DayFlow copy.' };
  }
  if (parsed.app !== 'DayFlow') {
    return { ok: false, error: 'That is not a DayFlow copy.' };
  }
  // A file from a newer version may hold fields this one would drop on the way
  // through. Refusing is the honest answer.
  if (typeof parsed.format !== 'number' || parsed.format > FORMAT) {
    return { ok: false, error: 'That copy was made by a newer version of DayFlow.' };
  }
  if (!Array.isArray(parsed.tasks)) {
    return { ok: false, error: 'That copy has no tasks in it.' };
  }

  return { ok: true, backup: parsed };
}

function at(record) {
  const parsed = Date.parse(record && record.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function usable(record) {
  return !!record
    && typeof record === 'object'
    && !Array.isArray(record)
    && typeof record.id === 'string'
    && record.id !== '';
}

// What bringing this file in would do, without doing any of it.
//
// `tombstones` are the deletions this device is holding. A task in the file
// that this device deleted is still brought back: importing a copy is a
// deliberate act, and "put this back" is the only thing it can mean. The
// tombstone has to go with it, or the next sync would delete the task all over
// again — which is the same thing undo does after a delete.
export function planRestore({ backup, tasks = [], tombstones = [] }) {
  const have = new Map((tasks || []).filter(usable).map(t => [t.id, t]));
  const buried = new Set((tombstones || []).map(t => t && t.id).filter(Boolean));

  const records = [
    ...(Array.isArray(backup && backup.projects) ? backup.projects : []),
    ...(Array.isArray(backup && backup.tasks) ? backup.tasks : []),
  ].filter(usable);

  const add = [];
  const update = [];
  const revive = [];
  let unchanged = 0;
  let unusable = 0;

  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);

    const mine = have.get(record.id);
    if (!mine) {
      (buried.has(record.id) ? revive : add).push(record);
      continue;
    }
    if (at(record) > at(mine)) update.push(record);
    else unchanged += 1;
  }
  unusable = records.length - seen.size;

  return { add, update, revive, unchanged, unusable };
}

// Everything the plan would write, as one list.
export function recordsOf(plan) {
  return [...plan.add, ...plan.revive, ...plan.update];
}

// What to tell somebody before they agree to it.
//
// Said as what will happen rather than as a count of rows, because the question
// in their head is "will this wreck what I have" and the answer is the last
// clause.
export function describePlan(plan) {
  const coming = plan.add.length + plan.revive.length;
  // Nothing to write is the answer, whatever the counts either side of it say.
  // "One already here. Nothing is removed." is true and buries the only thing
  // being asked: will this do anything at all.
  if (coming === 0 && plan.update.length === 0) {
    return 'Nothing in that copy is missing from this device.';
  }

  const parts = [];
  if (coming) parts.push(`${coming} to add`);
  if (plan.update.length) parts.push(`${plan.update.length} to bring up to date`);
  if (plan.unchanged) parts.push(`${plan.unchanged} already here`);
  return `${parts.join(', ')}. Nothing is removed.`;
}
