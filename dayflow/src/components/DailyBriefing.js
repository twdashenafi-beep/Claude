import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { getDailySummary, isAIConfigured } from '../services/ai';

const GREETINGS = ['Good morning', 'Good afternoon', 'Good evening'];
const NUDGES = [
  "You've got this! One task at a time.",
  "Start with the hardest task first.",
  "Small progress is still progress.",
  "Focus on what matters most today.",
  "Your future self will thank you.",
  "Consistency beats intensity.",
  "Every completed task is a win.",
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return GREETINGS[0];
  if (h < 17) return GREETINGS[1];
  return GREETINGS[2];
}

export default function DailyBriefing({ visible, onClose, tasks }) {
  const todayTasks = tasks.filter(t => t.viewScope === 'day' && t.taskType === 'todo');
  const openToday = todayTasks.filter(t => !t.completed);
  const completedToday = todayTasks.filter(t => t.completed);
  const highPrio = openToday.filter(t => t.priority === 'high');
  const oweTasks = tasks.filter(t => t.taskType === 'done_for_me' && !t.completed);
  const totalOweAmount = oweTasks.reduce((sum, t) => sum + (parseFloat(t.oweAmount) || 0), 0);
  const oweCurrencySymbol = oweTasks.length > 0 ? (oweTasks[0].oweCurrency === 'ETB' ? 'Br' : oweTasks[0].oweCurrency === 'GBP' ? '£' : oweTasks[0].oweCurrency === 'EUR' ? '€' : '$') : '$';

  const allWeek = tasks.filter(t => t.viewScope === 'week' && !t.completed);
  const allMonth = tasks.filter(t => t.viewScope === 'month' && !t.completed);

  // Pick once per opening, not on every render.
  const nudge = useMemo(() => NUDGES[Math.floor(Math.random() * NUDGES.length)], [visible]);

  // Optional Claude summary. Requires EXPO_PUBLIC_API_URL to point at the
  // DayFlow API server; without it the briefing below stands on its own.
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!visible || !isAIConfigured) return;
    let cancelled = false;
    setAiLoading(true);
    getDailySummary(todayTasks)
      .then(text => { if (!cancelled) setAiSummary(text); })
      .finally(() => { if (!cancelled) setAiLoading(false); });
    return () => { cancelled = true; };
  }, [visible]);

  const pct = todayTasks.length > 0 ? Math.round((completedToday.length / todayTasks.length) * 100) : 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={st.container}>
        <View style={st.header}>
          <View />
          <Text style={st.headerTitle}>Daily Briefing</Text>
          <TouchableOpacity onPress={onClose}><Text style={st.closeBtn}>Done</Text></TouchableOpacity>
        </View>

        <ScrollView style={st.body}>
          <Text style={st.greeting}>{getGreeting()} ✦</Text>

          {/* AI summary */}
          {isAIConfigured && (aiLoading || aiSummary) && (
            <View style={[st.card, st.aiCard]}>
              <Text style={st.cardTitle}>✦ Summary</Text>
              {aiLoading ? (
                <ActivityIndicator size="small" color="#007AFF" />
              ) : (
                <Text style={st.aiText}>{aiSummary}</Text>
              )}
            </View>
          )}

          {/* Today summary */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Today</Text>
            <View style={st.statRow}>
              <View style={st.stat}>
                <Text style={st.statNum}>{openToday.length}</Text>
                <Text style={st.statLabel}>Open</Text>
              </View>
              <View style={st.stat}>
                <Text style={[st.statNum, { color: '#34C759' }]}>{completedToday.length}</Text>
                <Text style={st.statLabel}>Done</Text>
              </View>
              <View style={st.stat}>
                <Text style={[st.statNum, { color: '#007AFF' }]}>{pct}%</Text>
                <Text style={st.statLabel}>Complete</Text>
              </View>
            </View>
            {/* Progress bar */}
            <View style={st.progressBg}>
              <View style={[st.progressFill, { width: `${pct}%` }]} />
            </View>
          </View>

          {/* High priority */}
          {highPrio.length > 0 && (
            <View style={st.card}>
              <Text style={st.cardTitle}>🔴 High Priority</Text>
              {highPrio.map(t => (
                <Text key={t.id} style={st.taskLine}>• {t.title}</Text>
              ))}
            </View>
          )}

          {/* Week & Month overview */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Upcoming</Text>
            <View style={st.statRow}>
              <View style={st.stat}>
                <Text style={[st.statNum, { color: '#34C759' }]}>{allWeek.length}</Text>
                <Text style={st.statLabel}>This Week</Text>
              </View>
              <View style={st.stat}>
                <Text style={[st.statNum, { color: '#FF9500' }]}>{allMonth.length}</Text>
                <Text style={st.statLabel}>This Month</Text>
              </View>
            </View>
          </View>

          {/* Owe Me */}
          {(oweTasks.length > 0 || totalOweAmount > 0) && (
            <View style={st.card}>
              <Text style={st.cardTitle}>Owe Me</Text>
              <Text style={st.oweTotal}>
                {oweTasks.length} pending {totalOweAmount > 0 ? `· ${oweCurrencySymbol}${totalOweAmount.toFixed(2)} owed` : ''}
              </Text>
              {oweTasks.slice(0, 3).map(t => (
                <Text key={t.id} style={st.taskLine}>
                  • {t.title} {t.owePerson ? `(${t.owePerson})` : ''}
                  {t.oweAmount ? ` — $${t.oweAmount}` : ''}
                </Text>
              ))}
            </View>
          )}

          {/* Motivational nudge */}
          <View style={[st.card, st.nudgeCard]}>
            <Text style={st.nudge}>✦ {nudge}</Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16,
    backgroundColor: '#FFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  closeBtn: { fontSize: 17, color: '#007AFF', fontWeight: '600' },
  body: { padding: 20 },
  greeting: { fontSize: 28, fontWeight: '700', color: '#000', marginBottom: 20 },
  card: {
    backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#000', marginBottom: 12 },
  statRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  stat: { alignItems: 'center', flex: 1 },
  statNum: { fontSize: 28, fontWeight: '700', color: '#000' },
  statLabel: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  progressBg: {
    height: 6, backgroundColor: '#F2F2F7', borderRadius: 3, overflow: 'hidden',
  },
  progressFill: {
    height: 6, backgroundColor: '#34C759', borderRadius: 3,
  },
  taskLine: { fontSize: 14, color: '#333', marginBottom: 6, lineHeight: 20 },
  oweTotal: { fontSize: 14, color: '#8E8E93', marginBottom: 8 },
  aiCard: { backgroundColor: '#FFF' },
  aiText: { fontSize: 15, color: '#333', lineHeight: 22 },
  nudgeCard: { backgroundColor: '#E8F0FE' },
  nudge: { fontSize: 15, color: '#007AFF', fontWeight: '500', lineHeight: 22 },
});
