import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { parseNaturalLanguage } from '../services/nlParser';
import { COLORS, SANS, SERIF } from '../utils/theme';

const SpeechRecognition =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export default function AIInput({ onAddTask, viewMode, activeTab = 'todo' }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [listening, setListening] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recognitionRef = useRef(null);
  const silenceTimer = useRef(null);

  useEffect(() => {
    if (listening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.25, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [listening]);

  const handleChange = useCallback((val) => {
    setText(val);
    setPreview(val.trim().length > 2 ? parseNaturalLanguage(val) : null);
  }, []);

  const doSubmit = useCallback((inputText) => {
    const t = inputText || text;
    if (!t.trim()) return;
    setProcessing(true);
    const parsed = parseNaturalLanguage(t);
    setTimeout(() => {
      const now = new Date();
      onAddTask({
        title: parsed.title,
        priority: parsed.priority,
        section: 'todo',
        taskType: activeTab,
        viewScope: parsed.viewScope || viewMode || 'day',
        date: parsed.date || now.toISOString(),
        dueDate: parsed.dueDate || now.toISOString(),
        dueTime: parsed.dueTime || '',
        reminderEnabled: !!parsed.dueTime,
        earlyReminderMinutes: 0,
        notes: '',
        attachments: [],
      });
      setText('');
      setPreview(null);
      setProcessing(false);
    }, 250);
  }, [text, viewMode, activeTab, onAddTask]);

  const submitRef = useRef(doSubmit);
  useEffect(() => { submitRef.current = doSubmit; }, [doSubmit]);

  const startListening = () => {
    if (!SpeechRecognition) return;
    if (recognitionRef.current) recognitionRef.current.abort();
    const r = new SpeechRecognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    recognitionRef.current = r;
    let final = '';

    r.onstart = () => { setListening(true); final = ''; };
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      const display = final + interim;
      setText(display);
      if (display.trim().length > 2) setPreview(parseNaturalLanguage(display));
      clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => r.stop(), 2000);
    };
    r.onerror = () => { setListening(false); clearTimeout(silenceTimer.current); };
    r.onend = () => {
      setListening(false);
      clearTimeout(silenceTimer.current);
      setTimeout(() => submitRef.current(), 150);
    };
    r.start();
  };

  const stopListening = () => {
    clearTimeout(silenceTimer.current);
    if (recognitionRef.current) recognitionRef.current.stop();
  };

  return (
    <View style={st.wrap}>
      <View style={[st.bar, listening && st.barActive]}>
        <Text style={st.pen}>✎</Text>
        <TextInput
          accessibilityLabel="Quick add a task"
          accessibilityHint="Type naturally, for example: call Mekdi tomorrow at 11am"
          style={st.input}
          placeholder={listening ? 'Listening…' : 'Write a line…'}
          placeholderTextColor={listening ? COLORS.accent : COLORS.inkFaint}
          value={text}
          onChangeText={handleChange}
          onSubmitEditing={() => doSubmit()}
          returnKeyType="done"
          blurOnSubmit={false}
        />
        {text.trim().length > 0 && !listening && (
          <TouchableOpacity
            style={st.send}
            onPress={() => doSubmit()}
            accessibilityRole="button"
            accessibilityLabel="Add this task"
          >
            <Text style={st.sendIcon}>↑</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[st.mic, listening && st.micActive]}
          onPress={listening ? stopListening : startListening}
          activeOpacity={0.5}
          accessibilityRole="button"
          aria-selected={listening}
          accessibilityLabel={listening ? 'Stop dictation' : 'Dictate a task'}
        >
          <Animated.View style={listening ? { transform: [{ scale: pulseAnim }] } : undefined}>
            <Text style={st.micIcon}>{listening ? '■' : '🎙'}</Text>
          </Animated.View>
        </TouchableOpacity>
      </View>

      {listening && (
        <View style={st.listenRow}>
          <Animated.View style={[st.dot, { transform: [{ scale: pulseAnim }] }]} />
          <Text style={st.listenText}>Speak naturally...</Text>
        </View>
      )}

      {preview && !listening && !processing && text.trim().length > 2 && (
        <View style={st.previewRow}>
          <Text style={st.previewText} numberOfLines={1}>{preview.title}</Text>
          {preview.hasDate && <Text style={st.tag}>{preview.viewScope}</Text>}
          {preview.hasTime && <Text style={st.tag}>{preview.dueTime}</Text>}
          {preview.priority === 'high' && <Text style={[st.tag, { color: COLORS.accent, fontWeight: '700' }]}>High</Text>}
        </View>
      )}

      {processing && <Text style={st.creating}>Creating...</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingTop: 14, paddingBottom: 2 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.rule,
    paddingBottom: 7,
  },
  barActive: { borderBottomColor: COLORS.accent },
  pen: { fontSize: 14, color: COLORS.inkFaint },
  input: {
    flex: 1, fontFamily: SANS, fontSize: 15.5, color: COLORS.ink,
    paddingVertical: 4, outlineStyle: 'none',
  },
  send: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.ink,
    justifyContent: 'center', alignItems: 'center',
  },
  sendIcon: { fontSize: 13, color: COLORS.sheet, fontWeight: '700', marginTop: -1 },
  mic: {
    width: 30, height: 30, borderRadius: 15,
    justifyContent: 'center', alignItems: 'center',
    marginRight: -4,
  },
  micActive: { backgroundColor: COLORS.accent },
  micIcon: { fontSize: 16, lineHeight: 20 },
  listenRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 6, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.accent },
  listenText: { fontFamily: SANS, fontSize: 11.5, color: COLORS.accent },
  previewRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 6, gap: 10 },
  previewText: { fontFamily: SERIF, fontSize: 12.5, fontStyle: 'italic', color: COLORS.inkFaint, flex: 1 },
  tag: { fontFamily: SANS, fontSize: 10.5, letterSpacing: 0.6, color: COLORS.inkSoft, textTransform: 'uppercase' },
  creating: { fontFamily: SANS, fontSize: 11.5, color: COLORS.inkFaint, paddingTop: 6 },
});
