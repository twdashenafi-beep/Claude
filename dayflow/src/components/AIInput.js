import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { parseNaturalLanguage } from '../services/nlParser';
import { COLORS, SANS, SERIF } from '../utils/theme';

// How long a pause means the sentence is over. Long enough to think of the
// next word, short enough that finishing does not need a second tap.
const SILENCE_MS = 2000;

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

    // A routing command with no task after it — "Owe me", and nothing else —
    // parses to an empty title. Adding that would put a task called "Owe me"
    // in the list, which is what a command is precisely not. The words stay in
    // the box instead, so the sentence can simply be finished.
    const parsed = parseNaturalLanguage(t);
    if (!parsed.title.trim()) return;

    setProcessing(true);
    setTimeout(() => {
      const now = new Date();
      // What was said decides which list it lands in. activeTab is only the
      // fallback: before this, "Sarah owes me the deck" was filed under To Do
      // because the tab was the only thing consulted.
      const taskType = parsed.taskType || activeTab;
      onAddTask({
        title: parsed.title,
        priority: parsed.priority,
        section: taskType === 'done_for_me' ? 'owe_me' : 'todo',
        taskType,
        owePerson: parsed.owePerson || '',
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

  // Leaving the page while the mic is live has to turn the mic off.
  //
  // This input is unmounted whenever Search or the Archive is opened, and a
  // SpeechRecognition nobody stops keeps the microphone on — the browser goes
  // on showing the recording indicator for a field that is no longer there.
  //
  // The handlers come off first. abort() still raises onend, which would
  // submit a task and set state on a component that has gone.
  useEffect(() => () => {
    clearTimeout(silenceTimer.current);
    const r = recognitionRef.current;
    if (!r) return;
    r.onstart = null;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try { r.abort(); } catch { /* already stopped */ }
    recognitionRef.current = null;
  }, []);

  const startListening = () => {
    if (!SpeechRecognition) return;
    if (recognitionRef.current) recognitionRef.current.abort();
    const r = new SpeechRecognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    recognitionRef.current = r;
    let final = '';

    // Armed here as well as on each result. Tapping the mic and then saying
    // nothing at all produces no result event, so a timer set only there was
    // never set — and the mic stayed on until it was tapped a second time.
    const armSilence = () => {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => r.stop(), SILENCE_MS);
    };

    r.onstart = () => { setListening(true); final = ''; armSilence(); };
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      const display = final + interim;
      setText(display);
      if (display.trim().length > 2) setPreview(parseNaturalLanguage(display));
      armSilence();
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
        {/* Only where there is something behind it. Speech recognition is a
            browser API; on iOS and Android there is no such thing in the
            bundle, and the button used to render there and do nothing at all
            when tapped. Nothing is lost by hiding it — both keyboards carry a
            dictation key of their own, which types into this same field. */}
        {SpeechRecognition ? (
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
        ) : null}
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
          {/* Which list this is heading for, before it is committed — the
              routing is inferred from the wording, so it has to be visible. */}
          {preview.taskType === 'done_for_me' && (
            <Text style={st.tag}>
              {preview.owePerson ? `Owe Me · ${preview.owePerson}` : 'Owe Me'}
            </Text>
          )}
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
