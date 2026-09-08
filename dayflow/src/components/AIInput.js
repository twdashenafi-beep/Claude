import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { parseNaturalLanguage } from '../services/nlParser';
import { COLORS, SANS, SERIF } from '../utils/theme';

// How long a pause means the sentence is over, when the button was tapped
// rather than held. Long enough to think of the next word, short enough that
// finishing does not need a second tap.
const SILENCE_MS = 2000;

// Below this, a press is a tap and dictation latches on until you pause or tap
// again. At or above it, the press is a hold: it ends the moment you let go.
// Holding is the faster way — speak, release, done, with nothing to wait for.
const HOLD_MS = 350;

// Recognition ends on its own more often than the spec suggests, particularly
// in Safari, which cuts off mid-sentence and reports a clean end rather than an
// error. When that happens the words gathered so far are kept and a new
// recogniser is started, so a long sentence survives being interrupted. The cap
// is on restarts that produce nothing: without it, a microphone that cannot
// hear at all would restart forever.
const MAX_EMPTY_RESTARTS = 3;

const SpeechRecognition =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

// The language to listen in.
//
// This was 'en-US' for everyone. A recogniser told to expect American English
// mishears every other accent — it is the difference between "call Mekdi" and
// "call Becky" — and the browser already knows what the device is set to.
function listeningLanguage() {
  if (typeof navigator === 'undefined') return 'en-US';
  return navigator.language || (navigator.languages && navigator.languages[0]) || 'en-US';
}

// What went wrong, in words rather than a code. Silence after a tap is the one
// case that needs no explaining.
const SPEECH_ERROR = {
  'not-allowed': 'Microphone blocked — allow it in your browser settings',
  'service-not-allowed': 'Microphone blocked — allow it in your browser settings',
  'audio-capture': 'No microphone found',
  network: 'Dictation needs a connection',
  'language-not-supported': 'Dictation is not available for this language',
};

// Transcripts arrive without reliable spacing, and across a restart there is
// none at all, so "call the" and "bank" become "call thebank".
function joinSpeech(a, b) {
  const left = String(a || '').trimEnd();
  const right = String(b || '').trimStart();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

export default function AIInput({ onAddTask, viewMode, activeTab = 'todo' }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [listening, setListening] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recognitionRef = useRef(null);
  const silenceTimer = useRef(null);
  const latched = useRef(false);
  const [speechError, setSpeechError] = useState('');

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
    // Cleared first: onend schedules a restart when this is still set, and a
    // restart after unmount turns the microphone back on for a field that has
    // gone.
    wants.current = false;
    const r = recognitionRef.current;
    if (!r) return;
    r.onstart = null;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try { r.abort(); } catch { /* already stopped */ }
    recognitionRef.current = null;
  }, []);

  // Everything the run needs to survive a restart. A recogniser that ends
  // mid-sentence is replaced by a new one, and closure variables would go with
  // the old instance — which is how half a sentence used to get committed.
  const wants = useRef(false);        // the user still intends to be dictating
  const spoken = useRef('');          // final transcript so far, across restarts
  const base = useRef('');            // whatever was typed before dictation began
  const emptyRestarts = useRef(0);
  const pressAt = useRef(0);

  const teardown = r => {
    if (!r) return;
    r.onstart = null; r.onresult = null; r.onerror = null; r.onend = null;
    try { r.abort(); } catch { /* already finished */ }
  };

  // Ends dictation and lets the result be submitted.
  const stopListening = useCallback(() => {
    wants.current = false;
    clearTimeout(silenceTimer.current);
    const r = recognitionRef.current;
    // stop() rather than abort(): abort discards anything not yet finalised,
    // which loses the last word or two of every sentence.
    if (r) { try { r.stop(); } catch { /* already stopped */ } }
  }, []);

  const startListening = useCallback((resuming = false) => {
    if (!SpeechRecognition) return;
    teardown(recognitionRef.current);

    if (!resuming) {
      // Dictation adds to what is in the box rather than replacing it, so a
      // line half typed is not thrown away by reaching for the microphone.
      base.current = text.trim();
      spoken.current = '';
      emptyRestarts.current = 0;
      setSpeechError('');
    }

    const r = new SpeechRecognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = listeningLanguage();
    r.maxAlternatives = 1;
    recognitionRef.current = r;
    wants.current = true;

    // Armed on start as well as on each result: tapping the mic and saying
    // nothing produces no result event, so a timer set only there was never
    // set at all, and the microphone stayed on until tapped again.
    const armSilence = () => {
      clearTimeout(silenceTimer.current);
      // Only a tap latches. A hold ends when the finger lifts, and a silence
      // timer would cut the speaker off mid-thought while they still held it.
      if (!latched.current) return;
      silenceTimer.current = setTimeout(() => stopListening(), SILENCE_MS);
    };

    const show = interim => {
      const display = joinSpeech(joinSpeech(base.current, spoken.current), interim);
      setText(display);
      setPreview(display.trim().length > 2 ? parseNaturalLanguage(display) : null);
    };

    r.onstart = () => { setListening(true); armSilence(); };

    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const said = e.results[i][0].transcript;
        if (e.results[i].isFinal) spoken.current = joinSpeech(spoken.current, said);
        else interim = joinSpeech(interim, said);
      }
      emptyRestarts.current = 0;
      show(interim);
      armSilence();
    };

    r.onerror = e => {
      const code = e && e.error;
      // 'no-speech' and 'aborted' are ordinary: the first is a quiet room, the
      // second is this component being taken off the page. Neither is worth a
      // message, and 'no-speech' should not stop a hold that is still held.
      if (code === 'no-speech' && wants.current) return;
      if (code && code !== 'aborted' && SPEECH_ERROR[code]) setSpeechError(SPEECH_ERROR[code]);
      wants.current = false;
      clearTimeout(silenceTimer.current);
      setListening(false);
      // A browser normally follows an error with an end of its own, which
      // releases the microphone. Not every one does, and a microphone left open
      // after a failure is the worst of both — no dictation, and the recording
      // indicator still lit. So end it here rather than assume.
      try { r.abort(); } catch { /* already finished */ }
    };

    r.onend = () => {
      clearTimeout(silenceTimer.current);

      // Ended on its own while still wanted. Safari does this constantly, and
      // treating it as the end of the sentence is what made dictation feel like
      // it was not listening: you were still talking and it had already gone.
      if (wants.current) {
        if (spoken.current) emptyRestarts.current = 0;
        else emptyRestarts.current += 1;
        if (emptyRestarts.current <= MAX_EMPTY_RESTARTS) {
          setTimeout(() => { if (wants.current) startListening(true); }, 120);
          return;
        }
        wants.current = false;
      }

      setListening(false);
      const said = joinSpeech(base.current, spoken.current);
      setTimeout(() => { if (said.trim()) submitRef.current(said); }, 120);
    };

    try { r.start(); } catch { /* already running */ }
  }, [text, stopListening]);

  // Press and hold to talk; a quick tap latches it on instead.
  //
  // Holding is the faster of the two and now the default: speak, let go, done,
  // with no pause to sit through and no second tap to remember. The tap is kept
  // for a long sentence, or a phone you would rather not hold a finger against.
  const onMicPressIn = () => {
    if (listening) { stopListening(); return; }
    pressAt.current = Date.now();
    latched.current = false;
    startListening();
  };

  const onMicPressOut = () => {
    if (!wants.current) return;
    if (Date.now() - pressAt.current >= HOLD_MS) stopListening();
    else { latched.current = true; }
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
            onPressIn={onMicPressIn}
            onPressOut={onMicPressOut}
            delayPressIn={0}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            activeOpacity={0.5}
            accessibilityRole="button"
            aria-selected={listening}
            accessibilityLabel={listening ? 'Stop dictation' : 'Dictate a task'}
            accessibilityHint="Hold to talk and let go to add it, or tap once and pause when you have finished"
          >
            <Animated.View style={listening ? { transform: [{ scale: pulseAnim }] } : undefined}>
              <Text style={st.micIcon}>{listening ? '■' : '🎙'}</Text>
            </Animated.View>
          </TouchableOpacity>
        ) : null}
      </View>

      {listening && (
        <View style={st.listenRow} dataSet={{ notice: 'true' }}>
          <Animated.View style={[st.dot, { transform: [{ scale: pulseAnim }] }]} />
          <Text style={st.listenText}>
            {latched.current ? 'Listening — pause when you have finished' : 'Listening — let go to add it'}
          </Text>
        </View>
      )}

      {/* A microphone that will not start used to fail in silence, which reads
          as a broken button rather than a permission that was never granted. */}
      {!listening && speechError ? (
        <View style={st.listenRow} dataSet={{ notice: 'true' }} accessibilityRole="alert">
          <Text style={st.listenText}>{speechError}</Text>
        </View>
      ) : null}

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
    width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
    marginRight: -10,
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
