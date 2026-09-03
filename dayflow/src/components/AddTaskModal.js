import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Platform, Switch,
} from 'react-native';

// Inject CSS to hide scrollbars on drum columns
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const id = 'drum-picker-style';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '.drum-scroll::-webkit-scrollbar { display: none; }';
    document.head.appendChild(style);
  }
}

import { PRIORITY, PRIORITY_COLORS } from '../utils/constants';
import DateTimeFields from './DateTimeFields';
import VoiceRecorder from './VoiceRecorder';
import { COLORS, SERIF } from '../utils/theme';

function SectionRow({ icon, label, value, onPress, isFirst, isLast, children, rightElement }) {
  return (
    <TouchableOpacity
      style={[
        rs.row,
        isFirst && rs.first,
        isLast && rs.last,
        !isLast && rs.border,
      ]}
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      disabled={!onPress}
    >
      {icon && <View style={rs.iconWrap}><Text style={rs.icon}>{icon}</Text></View>}
      <Text style={rs.label}>{label}</Text>
      <View style={rs.right}>
        {children}
        {rightElement}
        {value !== undefined && !children && !rightElement && (
          <>
            <Text style={rs.value}>{value}</Text>
            <Text style={rs.chevron}>›</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

function ToggleRow({ icon, iconBg, label, value, enabled, onToggle, isFirst, isLast, detail }) {
  return (
    <View style={[rs.row, isFirst && rs.first, isLast && rs.last, !isLast && rs.border]}>
      {icon && (
        <View style={[rs.iconBox, iconBg && { backgroundColor: iconBg }]}>
          <Text style={rs.iconBoxText}>{icon}</Text>
        </View>
      )}
      <View style={rs.toggleInfo}>
        <Text style={rs.label}>{label}</Text>
        {enabled && detail ? <Text style={rs.detail}>{detail}</Text> : null}
      </View>
      <Switch
        value={enabled}
        onValueChange={onToggle}
        trackColor={{ false: COLORS.rule, true: COLORS.ink }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const rs = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 16,
    backgroundColor: COLORS.sheet, minHeight: 44,
  },
  first: { borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  last: { borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule },
  iconWrap: { width: 28, marginRight: 10 },
  icon: { fontSize: 17 },
  iconBox: {
    width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  iconBoxText: { fontSize: 15, color: COLORS.sheet },
  label: { fontSize: 16, color: COLORS.ink },
  toggleInfo: { flex: 1 },
  detail: { fontSize: 13, color: COLORS.inkSoft, marginTop: 1 },
  right: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  value: { fontSize: 16, color: COLORS.inkSoft },
  chevron: { fontSize: 20, color: COLORS.inkFaint, marginLeft: 2, fontWeight: '300' },
});

// ── Priority Picker Popup ────────────────────────────────────────────────────

const PRIORITY_OPTIONS = [
  { key: 'none', label: 'None', color: COLORS.inkSoft },
  { key: 'low', label: 'Low', color: PRIORITY_COLORS.low },
  { key: 'medium', label: 'Medium', color: PRIORITY_COLORS.medium },
  { key: 'high', label: 'High', color: PRIORITY_COLORS.high },
];


// ── Main Component ───────────────────────────────────────────────────────────

export default function AddTaskModal({ visible, onClose, onAdd, section = 'todo', defaultTaskType = 'todo', viewMode, selectedDate: viewDate }) {
  // Core fields
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [voiceNoteUri, setVoiceNoteUri] = useState(null);


  // Date & time, as the shared fields speak it.
  const [due, setDue] = useState({ dueDate: '', dueTime: '' });
  // Organisation
  const taskType = defaultTaskType;
  const [priority, setPriority] = useState('none');

  // Owe Me fields
  const [owePerson, setOwePerson] = useState('');

  // Submit
  const handleAdd = () => {
    if (!title.trim()) return;

    const dateISO = due.dueDate || null;
    const timeStr = due.dueTime || null;

    const mappedPriority = priority === 'none' ? 'medium' : priority;
    const fallbackDate = (viewDate || new Date()).toISOString();

    onAdd({
      title: title.trim(),
      priority: mappedPriority,
      // Follows the type. TaskDetail reads either, and they disagreeing is how
      // a task ends up looking like one kind and behaving like the other.
      section: taskType === 'done_for_me' ? 'owe_me' : section,
      taskType,
      viewScope: viewMode || 'day',
      date: dateISO || fallbackDate,
      dueDate: dateISO || fallbackDate,
      dueTime: timeStr,
      reminderEnabled: !!(dateISO && timeStr),
      earlyReminderMinutes: 0,
      reminderDate: dateISO,
      reminderTime: timeStr,
      owePerson: owePerson.trim(),
      oweDescription: '',
      notes: notes.trim(),
      voiceNoteUri,
      attachments: [],
    });

    // Reset
    setTitle(''); setNotes(''); setVoiceNoteUri(null);
    setDue({ dueDate: '', dueTime: '' });
    setPriority('none');
    setOwePerson('');
    onClose();
  };

  const isHighPriority = priority === 'high';
  const isOwe = taskType === 'done_for_me';
  const canAdd = title.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} accessibilityRole="button">
            <Text style={s.cancel}>Cancel</Text>
          </TouchableOpacity>

          {/* Which list this is going into. The two are different kinds of
              thing — one is yours to do, the other is someone else's to
              deliver — and the sheet used to say "New Task" for both. */}
          <Text style={s.headerTitle}>{isOwe ? 'New Owe Me' : 'New To Do'}</Text>

          {/* There was no way to commit but pressing Enter in the title, which
              is invisible, and impossible once focus has moved to notes. */}
          <TouchableOpacity
            onPress={handleAdd}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel={isOwe ? 'Add to Owe Me' : 'Add to To Do'}
            aria-disabled={!canAdd}
          >
            <Text style={[s.save, !canAdd && s.saveOff]}>Add</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Title */}
          <TextInput
            style={s.titleInput}
            placeholder={isOwe ? 'What are you waiting on?' : 'What needs to be done?'}
            placeholderTextColor="#C7C7CC"
            value={title}
            onChangeText={setTitle}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleAdd}
            blurOnSubmit={false}
          />

          {/* Notes */}
          <TextInput
            style={s.notesInput}
            placeholder="Notes"
            placeholderTextColor="#D1D1D6"
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          {/* Voice note */}
          <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
            <VoiceRecorder
              existingUri={voiceNoteUri}
              onRecordingComplete={(uri) => setVoiceNoteUri(uri)}
              onDelete={() => setVoiceNoteUri(null)}
            />
          </View>

          {/* Date and time, shared with the task sheet so the two cannot drift */}
          <DateTimeFields value={due} onChange={setDue} />

          <View style={s.opts}>
            {/* Priority toggle — just high or none */}
            <TouchableOpacity
              style={[s.chip, isHighPriority && s.chipHigh]}
              accessibilityRole="button"
              accessibilityLabel={isHighPriority ? 'High priority. Tap to clear.' : 'Mark high priority'}
              onPress={() => setPriority(isHighPriority ? 'none' : 'high')}
            >
              <Text style={[s.chipIcon, isHighPriority && { color: COLORS.accent }]}>!</Text>
              <Text style={[s.chipLabel, isHighPriority && { color: COLORS.accent, fontWeight: '600' }]}>
                {isHighPriority ? 'High' : 'Priority'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Owe Me fields */}
          {taskType === 'done_for_me' && (
            <View style={s.oweSection}>
              <TextInput
                style={s.oweInput}
                placeholder="Who owes you this?"
                placeholderTextColor="#C7C7CC"
                value={owePerson}
                onChangeText={setOwePerson}
              />
              <Text style={s.oweHint}>
                Who you are waiting on. Add a date to remind yourself to chase it.
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

    </Modal>
  );
}

// ── Picker row styles ────────────────────────────────────────────────────────

const pickS = StyleSheet.create({
  opt: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 54,
  },
  optSel: {
    backgroundColor: '#F4F1EA',
  },
  optText: { flex: 1, fontSize: 16, color: COLORS.ink },
  optTextSel: { fontWeight: '600', color: COLORS.accent },
  check: { fontSize: 16, color: COLORS.accent, fontWeight: '600' },
});

// ── Main styles ──────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.sheet },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F4F1EA',
  },
  cancel: { fontSize: 17, color: COLORS.accent },
  save: { fontSize: 17, fontWeight: '600', color: COLORS.accent },
  saveOff: { color: '#C4BEB0' },
  headerTitle: { fontFamily: SERIF, fontSize: 17, fontWeight: '600', color: COLORS.ink },
  scroll: { flex: 1 },
  titleInput: {
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8,
    fontFamily: SERIF, fontSize: 23, fontWeight: '600', color: COLORS.ink, letterSpacing: -0.3,
  },
  notesInput: {
    paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16,
    fontSize: 16, color: COLORS.inkSoft, minHeight: 44,
  },
  opts: {
    flexDirection: 'row', paddingHorizontal: 20, gap: 8, paddingBottom: 12, flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#F4F1EA', borderRadius: 20,
  },
  chipOn: { backgroundColor: '#F4F1EA' },
  chipHigh: { backgroundColor: '#F6EBE8' },
  chipIcon: { fontSize: 13 },
  chipLabel: { fontSize: 14, color: COLORS.inkSoft },
  chipLabelOn: { color: COLORS.accent, fontWeight: '500' },
  oweSection: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },
  oweHint: { fontFamily: SERIF, fontSize: 13, fontStyle: 'italic', color: COLORS.inkFaint, lineHeight: 18 },
  oweInput: {
    fontSize: 15, color: COLORS.ink, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.rule, paddingBottom: 10,
  },
});
