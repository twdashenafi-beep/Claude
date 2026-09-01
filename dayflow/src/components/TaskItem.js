import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder,
} from 'react-native';
import { VoicePlayButton } from './VoiceRecorder';
import { COLORS, SANS, SERIF, currencySymbol } from '../utils/theme';

// One ruled line on the sheet: a checkbox, the task, and whatever the task
// carries on its right edge. No card, no background — the row is defined by
// the hairline beneath it, the way a line on paper is.
export default function TaskItem({ task, onToggle, onDelete, onPress, onLongPress }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);

  useEffect(() => {
    Animated.timing(opacityAnim, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 20 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderMove: (_, gs) => { if (gs.dx < 0) translateX.setValue(gs.dx); },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -100) {
          Animated.timing(translateX, { toValue: -500, duration: 160, useNativeDriver: true })
            .start(() => onDelete(task.id));
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      onToggle(task.id);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
      setTimeout(() => {
        if (lastTap.current === now) onPress && onPress(task);
      }, 300);
    }
  };

  const done = task.completed;
  const amount = task.oweAmount
    ? `${currencySymbol(task.oweCurrency)}${task.oweAmount}`
    : null;

  return (
    <Animated.View style={{ opacity: opacityAnim }}>
      <Animated.View style={[st.row, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <TouchableOpacity
          style={[st.check, done && st.checkDone]}
          onPress={() => onToggle(task.id)}
          activeOpacity={0.6}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {done && <Text style={st.checkMark}>✓</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={st.body}
          onPress={handleTap}
          onLongPress={() => onLongPress && onLongPress(task)}
          delayLongPress={400}
          activeOpacity={0.6}
        >
          <View style={st.titleRow}>
            {!done && task.priority === 'high' && <Text style={st.priority}>!</Text>}
            <Text style={[st.title, done && st.titleDone]} numberOfLines={1}>
              {task.title}
            </Text>
          </View>
          {task.owePerson ? (
            <Text style={[st.person, done && st.personDone]} numberOfLines={1}>
              {task.owePerson}
            </Text>
          ) : null}
        </TouchableOpacity>

        <View style={st.right}>
          {task.voiceNoteUri ? <VoicePlayButton uri={task.voiceNoteUri} /> : null}
          {!done && task.reminderEnabled && task.dueTime ? (
            <Text style={st.time}>{task.dueTime}</Text>
          ) : null}
          {amount ? (
            <Text style={[st.amount, done && st.amountDone]}>{amount}</Text>
          ) : null}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.rule,
    backgroundColor: COLORS.sheet,
  },
  check: {
    width: 17, height: 17, borderRadius: 2,
    borderWidth: 1, borderColor: '#B8B2A4',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 14,
  },
  checkDone: { backgroundColor: COLORS.check, borderColor: COLORS.check },
  checkMark: { fontSize: 11, color: COLORS.sheet, fontWeight: '700', marginTop: -1 },

  body: { flex: 1, paddingRight: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline' },
  priority: {
    fontFamily: SERIF, fontSize: 15, fontWeight: '700',
    color: COLORS.accent, marginRight: 6,
  },
  title: { flex: 1, fontFamily: SANS, fontSize: 15.5, color: COLORS.ink, letterSpacing: -0.1 },
  titleDone: { color: COLORS.done, textDecorationLine: 'line-through' },
  person: { fontFamily: SANS, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 },
  personDone: { color: COLORS.done },

  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: { fontFamily: SANS, fontSize: 12, color: COLORS.inkFaint, fontVariant: ['tabular-nums'] },
  amount: {
    fontFamily: SERIF, fontSize: 14.5, color: COLORS.accent,
    fontVariant: ['tabular-nums'],
  },
  amountDone: { color: COLORS.done, textDecorationLine: 'line-through' },
});
