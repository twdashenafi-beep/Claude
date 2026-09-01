import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { parseNaturalLanguage } from '../services/nlParser';

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
        <Text style={st.sparkle}>✦</Text>
        <TextInput
          style={st.input}
          placeholder={listening ? 'Listening...' : 'Add a task...'}
          placeholderTextColor={listening ? '#FF3B30' : '#C7C7CC'}
          value={text}
          onChangeText={handleChange}
          onSubmitEditing={() => doSubmit()}
          returnKeyType="done"
          blurOnSubmit={false}
        />
        {text.trim().length > 0 && !listening && (
          <TouchableOpacity style={st.send} onPress={() => doSubmit()}>
            <Text style={st.sendIcon}>↑</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[st.mic, listening && st.micActive]}
          onPress={listening ? stopListening : startListening}
          activeOpacity={0.5}
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
          {preview.hasDate && <Text style={st.tag}>📅 {preview.viewScope}</Text>}
          {preview.hasTime && <Text style={st.tag}>🕐 {preview.dueTime}</Text>}
          {preview.priority === 'high' && <Text style={[st.tag, { color: '#FF3B30' }]}>! High</Text>}
        </View>
      )}

      {processing && <Text style={st.creating}>Creating...</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 2 },
  bar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F5F5F7', borderRadius: 12, paddingHorizontal: 12, gap: 8,
  },
  barActive: { backgroundColor: '#FFF0F0', borderWidth: 1.5, borderColor: '#FF3B30' },
  sparkle: { fontSize: 14, color: '#007AFF', opacity: 0.5 },
  input: { flex: 1, fontSize: 15, color: '#000', paddingVertical: 10 },
  send: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#007AFF',
    justifyContent: 'center', alignItems: 'center',
  },
  sendIcon: { fontSize: 14, color: '#FFF', fontWeight: '700', marginTop: -1 },
  mic: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#E8E8ED',
    justifyContent: 'center', alignItems: 'center',
  },
  micActive: { backgroundColor: '#FF3B30' },
  micIcon: { fontSize: 17 },
  listenRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 5, paddingLeft: 4, gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3B30' },
  listenText: { fontSize: 12, color: '#FF3B30', fontWeight: '500' },
  previewRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 4, paddingLeft: 4, gap: 6 },
  previewText: { fontSize: 12, color: '#8E8E93', flex: 1 },
  tag: { fontSize: 11, color: '#007AFF', fontWeight: '500' },
  creating: { fontSize: 12, color: '#007AFF', paddingTop: 4, paddingLeft: 4 },
});
