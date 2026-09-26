import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView,
} from 'react-native';
import { PRIORITY, PRIORITY_COLORS } from '../utils/constants';
import { EARLY_REMINDER_OPTIONS } from '../services/notifications';
import { COLORS } from '../utils/theme';
import DateTimeFields from './DateTimeFields';
import VoiceRecorder from './VoiceRecorder';
import { notesOf, noteFields } from '../services/voiceNotes';
import { REPEATS, repeatOf } from '../services/repeat';
import { chaseMessage, owedBy, historyWith, chaseDetail } from '../services/chase';
import { shareText } from '../services/share';
import { clashNote, clockOf } from '../services/agenda';
import { deviceZone } from '../services/zones';
import { zoneNote } from '../services/due';
import { attachTo, detach, meetingOf, choices, keyOfEvent, keyOfTask } from '../services/meetings';

export default function TaskDetail({
  task, visible, onClose, onSave, onMove, place, onChased, onSeeAll,
  projects = [], tasks = [], diary = null, viewMode = 'day',
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [earlyReminderIdx, setEarlyReminderIdx] = useState(0);
  const [owePerson, setOwePerson] = useState('');
  const [viewScope, setViewScope] = useState('day');
  const [projectId, setProjectId] = useState('');
  const [voiceNotes, setVoiceNotes] = useState([]);
  const [taskType, setTaskType] = useState('todo');
  const [repeat, setRepeat] = useState('none');
  // Which meeting this is for, as { title, at } or null.
  const [meeting, setMeeting] = useState(null);
  // What happened the last time a chase was sent from here.
  const [chased, setChased] = useState('');

  useEffect(() => {
    if (task) {
      setTitle(task.title || '');
      setNotes(task.notes || '');
      setPriority(task.priority || 'medium');
      setDueDate(task.dueDate || task.date || '');
      setDueTime(task.dueTime || '');
      setReminderEnabled(task.reminderEnabled || false);
      const mins = task.earlyReminderMinutes || 0;
      const idx = EARLY_REMINDER_OPTIONS.findIndex(o => o.minutes === mins);
      setEarlyReminderIdx(idx >= 0 ? idx : 0);
      setOwePerson(task.owePerson || '');
      setViewScope(task.viewScope || 'day');
      setProjectId(task.projectId || '');
      setVoiceNotes(notesOf(task));
      setMeeting(task.meeting || null);
      setTaskType(task.taskType === 'done_for_me' || task.section === 'owe_me' ? 'done_for_me' : 'todo');
      setRepeat(repeatOf(task));
      setChased('');
    }
  }, [task]);

  if (!task) return null;

  const handleSave = () => {
    const earlyMinutes = EARLY_REMINDER_OPTIONS[earlyReminderIdx]?.minutes || 0;
    const owed = taskType === 'done_for_me';
    onSave(task.id, {
      // Both, always. They are read in different places, and a task whose type
      // and section disagree looks like one kind and behaves like the other.
      taskType,
      section: owed ? 'owe_me' : 'todo',
      // A name on a To Do reads as though somebody owes you your own task: the
      // row prints whoever is named whichever column it is in.
      owePerson: owed ? owePerson : '',
      title: title.trim() || task.title,
      notes,
      priority,
      dueDate,
      dueTime,
      // The zone is stamped when the time is set or changed, and never merely
      // because the sheet was opened somewhere else. Opening a call set for
      // three in London while standing in New York and pressing Save must not
      // quietly move it to three New York time — the same discipline as the
      // repeat anchor below, and for the same reason.
      ...(dueTime && dueTime !== (task.dueTime || '') ? { tz: deviceZone() } : null),
      ...(dueTime ? null : { tz: '' }),
      reminderEnabled: reminderEnabled || earlyMinutes > 0,
      earlyReminderMinutes: earlyMinutes,
      viewScope,
      projectId,
      repeat,
      meeting,
      // The anchor — which day of the month a monthly task is aiming at — is
      // dropped only when the date itself has just been changed, and it is
      // written again from the new one when the task next comes round.
      //
      // Only then. Clearing it on every save looked tidier and was wrong: rent
      // due on the 31st shows the 28th in February, so opening that task to fix
      // a typo and pressing Save would record the 28th as the intention and
      // move the rent by three days for good. A save that did not touch the
      // date must not move anything.
      ...(dueDate !== (task.dueDate || task.date || '') ? { repeatDay: null } : null),
      ...noteFields(voiceNotes),
    });
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };


  // Everything this person still owes, this task included.
  //
  // Read against the sheet as it stands rather than as it was saved: typing a
  // name in and chasing them should not need a save and a reopen in between,
  // and a title edited a moment ago should be the title that gets asked for.
  const asEdited = (tasks || []).map(t => (
    t && t.id === task.id
      ? { ...t, owePerson, taskType, title: title.trim() || t.title }
      : t
  ));
  const owedHere = owePerson.trim() ? owedBy(asEdited, owePerson) : [];
  // Finished ones count towards whether the person is worth a view of their
  // own; they do not count towards what gets asked for.
  const withThem = owePerson.trim() ? historyWith(asEdited, owePerson) : [];

  const sendChase = async () => {
    const message = chaseMessage(asEdited, owePerson, new Date());
    if (!message) return;
    setChased('');
    const result = await shareText(message);

    // Written whatever happens next, and written to every task the message
    // covered rather than only the one that is open — the message asked for all
    // of them, so all of them have been chased.
    //
    // Recorded even when the sheet is cancelled, because a chase is not an edit
    // to the task. It is a thing that happened, and the task sheet is not where
    // it gets to be undone.
    if (result !== 'cancelled' && onChased) onChased(owedHere.map(t => t.id));

    setChased({
      shared: '',
      cancelled: '',
      copied: 'Copied — paste it wherever you talk to them',
      unavailable: 'Nothing on this device could take it. Long-press the text to copy.',
    }[result] ?? '');
  };

  // What you have just chosen, not what was saved — so asking for Owe Me puts
  // the name field there at once, rather than after a save and a reopen.
  const isOweMe = taskType === 'done_for_me';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCancel} style={styles.headerBtn}>
            <Text style={styles.cancelBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Task</Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerBtn}>
            <Text style={styles.saveBtn}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          {/* Title */}
          <View style={styles.section}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.titleInput}
              accessibilityLabel="Task title"
              value={title}
              onChangeText={setTitle}
              placeholder="Task title"
              placeholderTextColor="#C7C7CC"
            />
          </View>

          {/* Priority */}
          <View style={styles.section}>
            <Text style={styles.label}>Priority</Text>
            <View style={styles.priorityRow}>
              {[PRIORITY.LOW, PRIORITY.MEDIUM, PRIORITY.HIGH].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityOption,
                    priority === p && { backgroundColor: PRIORITY_COLORS[p] + '20', borderColor: PRIORITY_COLORS[p] },
                  ]}
                  onPress={() => setPriority(p)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${p} priority`}
                  aria-checked={priority === p}
                >
                  <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[p] }]} />
                  <Text style={[
                    styles.priorityText,
                    priority === p && { color: PRIORITY_COLORS[p], fontWeight: '600' },
                  ]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Date and time. These used to be printed and nothing more, so a
              task's time could be set when it was created and never changed. */}
          <View style={styles.section}>
            <Text style={styles.label}>Date & Time</Text>
            <DateTimeFields
              value={{ dueDate, dueTime }}
              onChange={next => { setDueDate(next.dueDate); setDueTime(next.dueTime); }}
            />
            {/* Said here, where the time is being chosen and there is still
                time to choose another one. Not a warning and not a block — you
                are allowed to put a task in the middle of a meeting, and
                sometimes the meeting is where you do it. It simply says what
                is already there. */}
            {/* Where the time came from, when this device is somewhere else.
                A task that reads 10:00 when you typed 15:00 is either a
                conversion or a bug, and only one of those is worth leaving
                somebody to work out for themselves. */}
            {zoneNote({ ...task, dueDate, dueTime, tz: dueTime === (task.dueTime || '') ? task.tz : deviceZone() }) ? (
              <Text style={styles.chaseNote} dataSet={{ zonenote: 'true' }}>
                {zoneNote({ ...task, dueDate, dueTime, tz: dueTime === (task.dueTime || '') ? task.tz : deviceZone() })}
              </Text>
            ) : null}
            {diary && clashNote(diary.events, dueDate, dueTime) ? (
              <Text style={styles.clash} dataSet={{ clash: 'true' }}>
                {clashNote(diary.events, dueDate, dueTime)}
              </Text>
            ) : null}
          </View>

          {/* Where it sits, without having to drag it there.
              Prioritising is usually "this one first" rather than a precise
              placement, and a button says that in one tap where a drag asks for
              a held finger and a steady hand. Dragging is still there for the
              placements a button cannot express. */}
          <View style={styles.section}>
            <Text style={styles.label}>Order</Text>
            <View style={styles.scopeRow}>
              {[
                { key: 'top', to: 'top', label: '⤒ To the top', can: !!place && place.index > 0 },
                { key: 'up', to: -1, label: '↑ Up', can: !!place && place.index > 0 },
                { key: 'down', to: 1, label: '↓ Down', can: !!place && place.index < place.total - 1 },
              ].map(step => (
                <TouchableOpacity
                  key={step.key}
                  style={[styles.scopeBtn, !step.can && styles.scopeBtnOff]}
                  disabled={!step.can}
                  aria-disabled={!step.can}
                  onPress={() => { onMove(task.id, step.to); onClose(); }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    step.key === 'top' ? 'Move to the top of the list'
                      : step.key === 'up' ? 'Move up one place' : 'Move down one place'
                  }
                >
                  <Text style={[styles.scopeText, !step.can && styles.scopeTextOff]}>
                    {step.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Which column it lives in — for a long time the one thing about a
              task that could not be changed. The only way across was to delete
              it and type it again on the other side, losing its date, its notes
              and its recording: not a move, a retype with casualties. */}
          <View style={styles.section}>
            <Text style={styles.label}>Column</Text>
            <View style={styles.scopeRow}>
              {[
                { key: 'todo', label: 'To Do' },
                { key: 'done_for_me', label: 'Owe Me' },
              ].map(col => (
                <TouchableOpacity
                  key={col.key}
                  style={[styles.scopeBtn, taskType === col.key && styles.scopeBtnOn]}
                  onPress={() => setTaskType(col.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: taskType === col.key }}
                  accessibilityLabel={
                    taskType === col.key ? `Already in ${col.label}` : `Move to ${col.label}`
                  }
                >
                  <Text style={[styles.scopeText, taskType === col.key && styles.scopeTextOn]}>
                    {col.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* What this is for.
              The app has known there is a board call at eleven since the diary
              arrived, and had no idea that three things on the list were for
              it — so "what am I meant to walk in with" was answered by memory,
              which is the one place it should not live.

              Only shown when there is a diary to choose from, and only ever
              meetings with an hour on them: an offsite is not something you
              bring three documents to at a quarter past ten. */}
          {diary && choices(diary.events, dueDate, new Date(), viewMode).length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.label}>For a meeting</Text>
              <View style={styles.meetingList}>
                {choices(diary.events, dueDate, new Date(), viewMode).map(event => {
                  const on = keyOfTask({ meeting }) === keyOfEvent(event);
                  return (
                    <TouchableOpacity
                      key={event.id}
                      style={[styles.meetingRow, on && styles.meetingRowOn]}
                      onPress={() => {
                        if (on) { setMeeting(detach.meeting); return; }
                        setMeeting(attachTo(event).meeting);
                        // A thing you are preparing for a Thursday meeting is a
                        // Thursday thing. Only when no date was chosen, and only
                        // the date — the hour is when the meeting is, not when
                        // the preparation happens.
                        if (!dueDate) setDueDate(new Date(event.start).toISOString());
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${on ? 'Not for' : 'For'} ${event.title} at ${clockOf(event.start)}`}
                    >
                      <Text style={[styles.meetingWhen, on && styles.meetingOnText]}>
                        {clockOf(event.start)}
                      </Text>
                      <Text
                        style={[styles.meetingTitle, on && styles.meetingOnText]}
                        numberOfLines={1}
                      >
                        {event.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {/* The meeting it was attached to is not in the diary any more —
                  moved, cancelled, or the calendar was replaced. Said rather
                  than left pointing at nothing, because a meeting that has
                  moved is exactly the thing worth knowing before you have
                  prepared for it. */}
              {meetingOf({ meeting })
                && !diary.events.some(e => keyOfEvent(e) === keyOfTask({ meeting })) ? (
                  <Text style={styles.clash}>
                    {`For ${meetingOf({ meeting }).title}, which is no longer in the diary`}
                  </Text>
                ) : null}
            </View>
          ) : null}

          {/* Tasks that come back.
              There is no series here and no instances: tick it off and the next
              one appears, carrying this setting with it, and nothing ever asks
              whether you meant this one or all the future ones. Four chips,
              the same control as the scopes below, because it is the same kind
              of choice — one of a short list, one at a time. */}
          <View style={styles.section}>
            <Text style={styles.label}>Repeat</Text>
            <View style={styles.scopeRow}>
              {REPEATS.map(option => {
                const on = repeat === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.scopeBtn, on && styles.scopeBtnOn]}
                    onPress={() => setRepeat(option.key)}
                    accessibilityRole="radio"
                    aria-checked={on}
                    accessibilityLabel={
                      option.key === 'none' ? 'Does not repeat' : `Repeats ${option.label}`
                    }
                  >
                    <Text style={[styles.scopeText, on && styles.scopeTextOn]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Which horizon it shows under. Fixed at creation until now, so a
              task that turned out to be a this-month job was stuck on today. */}
          <View style={styles.section}>
            <Text style={styles.label}>Show under</Text>
            <View style={styles.scopeRow}>
              {[
                { key: 'day', label: 'Day' },
                { key: 'week', label: 'Week' },
                { key: 'month', label: 'Month' },
              ].map(scope => {
                const on = viewScope === scope.key;
                return (
                  <TouchableOpacity
                    key={scope.key}
                    style={[styles.scopeBtn, on && styles.scopeBtnOn]}
                    onPress={() => setViewScope(scope.key)}
                    accessibilityRole="radio"
                    aria-checked={on}
                    accessibilityLabel={`Show under ${scope.label}`}
                  >
                    <Text style={[styles.scopeText, on && styles.scopeTextOn]}>{scope.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Which project it belongs to.
              This could already be changed by holding a task, which is a
              gesture nobody finds by accident. Opening a task is where you go
              to change what a task is, and everything else about it was
              already here. Same control as the scopes above, because it is the
              same kind of choice — one of a short list, one at a time. */}
          {projects.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.label}>Project</Text>
              <View style={styles.projectRow}>
                {[{ id: '', name: 'Everything' }, ...projects].map(p => {
                  const on = (projectId || '') === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id || 'everything'}
                      style={[styles.scopeBtn, styles.projectBtn, on && styles.scopeBtnOn]}
                      onPress={() => setProjectId(p.id)}
                      accessibilityRole="radio"
                      aria-checked={on}
                      accessibilityLabel={`Put in ${p.name}`}
                    >
                      <Text
                        style={[styles.scopeText, on && styles.scopeTextOn]}
                        numberOfLines={1}
                      >
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Remind Me Early */}
          <View style={styles.section}>
            <Text style={styles.label}>Remind Me Early</Text>
            <View style={styles.reminderOptions}>
              {EARLY_REMINDER_OPTIONS.map((opt, i) => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.reminderOption, earlyReminderIdx === i && styles.reminderOptionActive]}
                  onPress={() => setEarlyReminderIdx(i)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Remind ${opt.label.toLowerCase()}`}
                  aria-checked={earlyReminderIdx === i}
                >
                  <Text style={[
                    styles.reminderOptionText,
                    earlyReminderIdx === i && styles.reminderOptionTextActive,
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Owe Person (for done_for_me tasks) */}
          {isOweMe && (
            <View style={styles.section}>
              <Text style={styles.label}>Person</Text>
              <TextInput
                style={styles.input}
                value={owePerson}
                onChangeText={setOwePerson}
                placeholder="Who owes you?"
                placeholderTextColor="#C7C7CC"
              />

              {/* Asking for it back.
                  The column has always known who owes you what and how long it
                  has been, and has never once helped you ask. Chasing is also
                  not done a task at a time: if the agent owes you the inventory
                  and the meter reading, that is one message, not two. So this
                  writes for the person rather than for the task — everything
                  they owe, oldest first — and hands it to the share sheet,
                  which is where the choice of WhatsApp or mail already lives
                  and where the words can be changed before they go. */}
              {owedHere.length > 0 ? (
                <TouchableOpacity
                  style={styles.chaseBtn}
                  onPress={sendChase}
                  accessibilityRole="button"
                  accessibilityLabel={
                    owedHere.length > 1
                      ? `Write a chase to ${owePerson.trim()} for ${owedHere.length} things`
                      : `Write a chase to ${owePerson.trim()}`
                  }
                >
                  <Text style={styles.chaseText}>
                    {owedHere.length > 1
                      ? `✎  Chase ${owePerson.trim()} — ${owedHere.length} things`
                      : `✎  Chase ${owePerson.trim()}`}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {/* Whether you have already asked, and when. The row has room
                  for the count; this is where the rest of it goes. */}
              {chaseDetail(task) ? (
                <Text style={styles.chaseNote}>{chaseDetail(task)}</Text>
              ) : null}

              {/* Everything one person owes you, in one place.
                  An executive does not think "which tasks are outstanding", they
                  think "what is outstanding with Marchetti" — and the column is
                  sorted by task, so the answer is scattered down it. This is the
                  search sheet with a name already in it, which is the whole of
                  what was missing. */}
              {withThem.length > 1 && onSeeAll ? (
                <TouchableOpacity
                  onPress={() => onSeeAll(owePerson.trim())}
                  style={styles.seeAllBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`See everything ${owePerson.trim()} owes you`}
                >
                  <Text style={styles.seeAllText}>
                    {`See everything ${owePerson.trim()} owes you`}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {chased ? <Text style={styles.chaseNote}>{chased}</Text> : null}
            </View>
          )}

          {/* Notes, typed and spoken.
              A voice note is a note you did not want to type, so it lives
              under the same heading rather than earning one of its own. It sits
              directly under the box in the add sheet too — the two sheets
              putting the same thing in two places is how a person learns that
              one of them cannot do it. Which, until now, was true: a note could
              only ever be attached in the seconds before a task existed, and
              the moment you pressed Add the offer was withdrawn for good. */}
          <View style={styles.section}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={styles.notesInput}
              accessibilityLabel="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Add notes..."
              placeholderTextColor="#C7C7CC"
              multiline
              textAlignVertical="top"
            />
            <VoiceRecorder
              notes={voiceNotes}
              onAdd={uri => setVoiceNotes(list => [...list, uri])}
              onRemove={i => setVoiceNotes(list => list.filter((_, at) => at !== i))}
            />
          </View>

          {/* Attachments (read-only) */}
          {task.attachments && task.attachments.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.label}>Attachments</Text>
              <View style={styles.attachGrid}>
                {task.attachments.map((file, idx) => (
                  <View key={idx} style={styles.attachChip}>
                    <View style={styles.attachIcon}>
                      <Text style={styles.attachIconText}>
                        {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                      </Text>
                    </View>
                    <Text style={styles.attachName} numberOfLines={1}>{file.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8FA',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.rule,
    backgroundColor: COLORS.sheet,
  },
  headerBtn: {
    minWidth: 60,
  },
  cancelBtn: {
    fontSize: 16,
    color: COLORS.inkSoft,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.ink,
  },
  saveBtn: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.accent,
    textAlign: 'right',
  },
  body: {
    padding: 20,
  },
  section: {
    marginBottom: 20,
  },
  scopeRow: { flexDirection: 'row', gap: 8 },
  // Wraps rather than divides: three scopes share a row evenly, but a project
  // list is however long it is, and a seventh share of the width fits no name.
  projectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Not flex: 0 — in React Native that is flexBasis: 0 as well as flexGrow: 0,
  // so the button collapses to its padding and the name disappears. What is
  // wanted is "do not stretch, but be as wide as your text".
  projectBtn: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: 14 },
  scopeBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderRadius: 8, borderWidth: 1, borderColor: '#E5E5EA',
  },
  scopeBtnOn: { backgroundColor: '#00000010', borderColor: '#C7C2B4' },
  scopeBtnOff: { opacity: 0.35 },
  chaseBtn: { marginTop: 10, alignSelf: 'flex-start', paddingVertical: 6 },
  chaseText: { fontSize: 14, color: COLORS.accent, fontWeight: '600' },
  seeAllBtn: { paddingVertical: 10, marginTop: 2 },
  seeAllText: { fontSize: 13.5, color: COLORS.accent },
  chaseNote: { marginTop: 6, fontSize: 12.5, color: '#8E8E93' },
  clash: { marginTop: 8, fontSize: 12.5, color: COLORS.accent, fontStyle: 'italic' },
  meetingList: { marginTop: 2 },
  meetingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, paddingHorizontal: 10, marginHorizontal: -10,
    borderRadius: 8,
  },
  meetingRowOn: { backgroundColor: '#EFEAE0' },
  meetingWhen: { fontSize: 13, color: '#8E8E93', minWidth: 44 },
  meetingTitle: { flex: 1, fontSize: 14.5, color: COLORS.ink },
  meetingOnText: { color: COLORS.accent, fontWeight: '600' },
  scopeTextOff: { color: '#B5AFA1' },
  scopeText: { fontSize: 14, color: '#8E8E93' },
  scopeTextOn: { color: '#3A362C', fontWeight: '600' },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.inkSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  titleInput: {
    backgroundColor: COLORS.sheet,
    borderRadius: 12,
    padding: 14,
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.ink,
    borderWidth: 0.5,
    borderColor: COLORS.rule,
  },
  input: {
    backgroundColor: COLORS.sheet,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: COLORS.ink,
    borderWidth: 0.5,
    borderColor: COLORS.rule,
  },
  notesInput: {
    backgroundColor: COLORS.sheet,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: COLORS.ink,
    borderWidth: 0.5,
    borderColor: COLORS.rule,
    minHeight: 100,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: COLORS.sheet,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.rule,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  priorityText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.inkSoft,
  },
  reminderOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reminderOption: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#F4F1EA',
    borderRadius: 8,
  },
  reminderOptionActive: {
    backgroundColor: COLORS.accent,
  },
  reminderOptionText: {
    fontSize: 14,
    color: COLORS.inkSoft,
    fontWeight: '500',
  },
  reminderOptionTextActive: {
    color: COLORS.sheet,
    fontWeight: '600',
  },
  attachGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  attachChip: {
    backgroundColor: COLORS.sheet,
    borderRadius: 10,
    padding: 10,
    borderWidth: 0.5,
    borderColor: COLORS.rule,
    alignItems: 'center',
    gap: 6,
    width: 90,
  },
  attachIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F4F1EA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachIconText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.inkSoft,
  },
  attachName: {
    fontSize: 10,
    color: COLORS.inkSoft,
    textAlign: 'center',
  },
});
