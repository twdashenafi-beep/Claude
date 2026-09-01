import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder,
} from 'react-native';
import { VoicePlayButton } from './VoiceRecorder';

export default function TaskItem({ task, onToggle, onDelete, onPress, onLongPress }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.97)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 10, tension: 80, useNativeDriver: true }),
    ]).start();
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 20,
      onPanResponderMove: (_, gs) => { if (gs.dx < 0) translateX.setValue(gs.dx); },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -100) {
          Animated.timing(translateX, { toValue: -400, duration: 180, useNativeDriver: true })
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
      // Double tap = complete
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 0.94, duration: 60, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
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

  return (
    <Animated.View style={{ opacity: opacityAnim, transform: [{ scale: scaleAnim }] }}>
      <Animated.View
        style={[st.row, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={[st.check, done && st.checkDone]}
          onPress={() => {
            Animated.sequence([
              Animated.timing(scaleAnim, { toValue: 0.94, duration: 60, useNativeDriver: true }),
              Animated.spring(scaleAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
            ]).start();
            onToggle(task.id);
          }}
          activeOpacity={0.5}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {done && <Text style={st.checkIcon}>✓</Text>}
        </TouchableOpacity>

        {!done && task.priority === 'high' && <Text style={st.prio}>!</Text>}

        <TouchableOpacity
          style={st.body}
          onPress={handleTap}
          onLongPress={() => onLongPress && onLongPress(task)}
          delayLongPress={400}
          activeOpacity={0.6}
        >
          <Text style={[st.title, done && st.titleDone]} numberOfLines={1}>{task.title}</Text>
          {task.oweAmount ? (
            <Text style={st.sub}>{task.oweCurrency === 'ETB' ? 'Br' : task.oweCurrency === 'GBP' ? '£' : task.oweCurrency === 'EUR' ? '€' : '$'}{task.oweAmount}</Text>
          ) : null}
        </TouchableOpacity>

        {task.voiceNoteUri && <VoicePlayButton uri={task.voiceNoteUri} />}
        {!done && task.reminderEnabled && task.dueTime && <Text style={st.bell}>🔔</Text>}
      </Animated.View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#FFF',
    minHeight: 52,
  },
  check: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#D1D1D6',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  checkDone: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  checkIcon: { fontSize: 13, color: '#FFF', fontWeight: '700', marginTop: -1 },
  prio: { fontSize: 17, fontWeight: '800', color: '#FF3B30', marginRight: 8 },
  body: { flex: 1 },
  title: { fontSize: 17, fontWeight: '400', color: '#000', letterSpacing: -0.2 },
  titleDone: { textDecorationLine: 'line-through', color: '#C7C7CC' },
  sub: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  bell: { fontSize: 12, marginLeft: 8, opacity: 0.6 },
});
