import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Platform } from 'react-native';
import { syncTaskToCalendar } from '../services/calendar';

export default function QuickActions({
  visible, task, onClose, onComplete, onEdit, onDelete, onPriority, onScope,
}) {
  const [calendarState, setCalendarState] = useState('idle');

  // The sheet is reused across tasks — clear the last result when it reopens.
  useEffect(() => { setCalendarState('idle'); }, [task?.id, visible]);

  if (!task) return null;

  // expo-calendar has no web implementation, so the row is native-only.
  const canSyncCalendar = Platform.OS !== 'web' && !!task.dueDate;

  const addToCalendar = async () => {
    setCalendarState('saving');
    const eventId = await syncTaskToCalendar({ ...task, date: task.dueDate || task.date });
    setCalendarState(eventId ? 'saved' : 'failed');
    if (eventId) setTimeout(onClose, 600);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity
        style={st.overlay}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <View style={st.sheet}>
          <Text style={st.title} numberOfLines={1}>{task.title}</Text>

          <TouchableOpacity style={st.action} onPress={() => { onComplete(task.id); onClose(); }}>
            <Text style={st.actionIcon}>{task.completed ? '↩' : '✓'}</Text>
            <Text style={st.actionText}>{task.completed ? 'Reopen' : 'Complete'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.action} onPress={() => { onClose(); setTimeout(() => onEdit(task), 100); }}>
            <Text style={st.actionIcon}>✎</Text>
            <Text style={st.actionText}>Edit</Text>
          </TouchableOpacity>

          {canSyncCalendar && (
            <TouchableOpacity
              style={st.action}
              onPress={addToCalendar}
              disabled={calendarState === 'saving'}
            >
              <Text style={st.actionIcon}>📅</Text>
              <Text style={st.actionText}>
                {calendarState === 'saving'
                  ? 'Adding...'
                  : calendarState === 'saved'
                  ? 'Added to calendar'
                  : calendarState === 'failed'
                  ? 'Calendar unavailable'
                  : 'Add to Calendar'}
              </Text>
            </TouchableOpacity>
          )}

          <View style={st.divider} />
          <Text style={st.sectionLabel}>PRIORITY</Text>

          <View style={st.prioRow}>
            {[
              { key: 'high', label: 'High', color: '#FF3B30' },
              { key: 'medium', label: 'Medium', color: '#FF9500' },
              { key: 'low', label: 'Low', color: '#8E8E93' },
            ].map(p => (
              <TouchableOpacity
                key={p.key}
                style={[st.prioBtn, task.priority === p.key && { backgroundColor: p.color + '18', borderColor: p.color }]}
                onPress={() => { onPriority(task.id, p.key); onClose(); }}
              >
                <View style={[st.prioDot, { backgroundColor: p.color }]} />
                <Text style={[st.prioText, task.priority === p.key && { color: p.color, fontWeight: '600' }]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={st.divider} />

          {/* Which horizon the task belongs to. It was fixed when the task was
              made, so something that turned out to be a this-week job rather
              than a today job had nowhere to go. */}
          <Text style={st.sectionLabel}>SHOW UNDER</Text>
          <View style={st.prioRow}>
            {[
              { key: 'day', label: 'Day' },
              { key: 'week', label: 'Week' },
              { key: 'month', label: 'Month' },
            ].map(scope => {
              const here = task.viewScope === scope.key;
              return (
                <TouchableOpacity
                  key={scope.key}
                  style={[st.prioBtn, here && st.scopeOn]}
                  disabled={here}
                  accessibilityRole="button"
                  aria-disabled={here}
                  accessibilityLabel={here ? `Already under ${scope.label}` : `Move to ${scope.label}`}
                  onPress={() => { onScope(task.id, scope.key); onClose(); }}
                >
                  <Text style={[st.prioText, here && st.scopeOnText]}>{scope.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={st.divider} />

          <TouchableOpacity style={st.action} onPress={() => { onDelete(task.id); onClose(); }}>
            <Text style={[st.actionIcon, { color: '#FF3B30' }]}>✕</Text>
            <Text style={[st.actionText, { color: '#FF3B30' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', paddingBottom: 40, paddingHorizontal: 16,
  },
  sheet: {
    backgroundColor: '#FFF', borderRadius: 14, overflow: 'hidden', padding: 16,
  },
  title: {
    fontSize: 16, fontWeight: '600', color: '#000', marginBottom: 16, textAlign: 'center',
  },
  action: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12,
  },
  actionIcon: { fontSize: 18, width: 24, textAlign: 'center', color: '#007AFF' },
  actionText: { fontSize: 16, color: '#000' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA', marginVertical: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#8E8E93', letterSpacing: 0.5, marginTop: 8, marginBottom: 8 },
  prioRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  prioBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5EA',
  },
  prioDot: { width: 6, height: 6, borderRadius: 3 },
  prioText: { fontSize: 13, color: '#8E8E93' },
  scopeOn: { backgroundColor: '#00000010', borderColor: '#C7C2B4' },
  scopeOnText: { color: '#3A362C', fontWeight: '600' },
});
