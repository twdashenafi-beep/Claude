import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Switch,
} from 'react-native';
import { PRIORITY, PRIORITY_COLORS } from '../utils/constants';
import { EARLY_REMINDER_OPTIONS } from '../services/notifications';
import { COLORS } from '../utils/theme';
import DateTimeFields from './DateTimeFields';

export default function TaskDetail({ task, visible, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [earlyReminderIdx, setEarlyReminderIdx] = useState(0);
  const [owePerson, setOwePerson] = useState('');
  const [viewScope, setViewScope] = useState('day');

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
    }
  }, [task]);

  if (!task) return null;

  const handleSave = () => {
    const earlyMinutes = EARLY_REMINDER_OPTIONS[earlyReminderIdx]?.minutes || 0;
    onSave(task.id, {
      title: title.trim() || task.title,
      notes,
      priority,
      dueDate,
      dueTime,
      reminderEnabled: reminderEnabled || earlyMinutes > 0,
      earlyReminderMinutes: earlyMinutes,
      owePerson,
      viewScope,
    });
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return 'No date';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const formatDisplayTime = (timeStr) => {
    if (!timeStr) return 'No time';
    try {
      const [h, m] = timeStr.split(':').map(Number);
      const p = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${h12}:${String(m).padStart(2, '0')} ${p}`;
    } catch {
      return timeStr;
    }
  };

  const isOweMe = task.taskType === 'done_for_me' || task.section === 'owe_me';

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

          {/* Remind Me Early */}
          <View style={styles.section}>
            <Text style={styles.label}>Remind Me Early</Text>
            <View style={styles.reminderOptions}>
              {EARLY_REMINDER_OPTIONS.map((opt, i) => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.reminderOption, earlyReminderIdx === i && styles.reminderOptionActive]}
                  onPress={() => setEarlyReminderIdx(i)}
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
            </View>
          )}

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add notes..."
              placeholderTextColor="#C7C7CC"
              multiline
              textAlignVertical="top"
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
  scopeBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderRadius: 8, borderWidth: 1, borderColor: '#E5E5EA',
  },
  scopeBtnOn: { backgroundColor: '#00000010', borderColor: '#C7C2B4' },
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
  metaCard: {
    backgroundColor: COLORS.sheet,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: COLORS.rule,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F1EA',
  },
  metaLabel: {
    fontSize: 14,
    color: COLORS.inkSoft,
  },
  metaValue: {
    fontSize: 14,
    color: COLORS.ink,
    fontWeight: '500',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
