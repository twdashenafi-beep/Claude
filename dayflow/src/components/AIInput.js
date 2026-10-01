import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { speechEngine, withSpeechPermission } from '../services/speech';
import { parseNaturalLanguage } from '../services/nlParser';
import { whenPreview } from '../services/due';
import { clashNote } from '../services/agenda';
import { deviceZone } from '../services/zones';
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

// And a ceiling on restarts of any kind.
//
// The cap above counts only restarts that heard nothing, and it resets the
// moment anything is said — which is fine for a browser that gives up
// occasionally and fatal for a phone that ends the session after every phrase.
// There, something had always just been said, so the counter was always zero
// and the loop had no end: each cycle another recogniser, each recogniser
// another task.
const MAX_RESTARTS = 8;

// How long a start is given before it is treated as never having happened.
//
// On a phone start() is asynchronous — it asks for permission and only then
// reaches the recogniser — so a failure on that path arrives as neither a throw
// nor an error event. Nothing happens at all, and the button simply looks
// broken. Generous, because a cold start on a phone is not instant.
const START_GRACE_MS = 5000;

// "Owe me" on its own is not a sentence anybody has finished saying. It is an
// instruction with its task still to come, and naming the column first is
// exactly when you are most likely to pause — you have said where it goes and
// are now thinking about what it is.
//
// The pause that ends dictation would end it there, leaving the words in the
// box, the microphone off and nothing added, which looks precisely like the
// routing not working. So a command on its own buys more time. Not unlimited:
// a phone that hears "owe me" from a pocket must not listen for ever.
const COMMAND_WAITS = 3;


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

export default function AIInput({ onAddTask, viewMode, activeTab = 'todo', diary = null }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [listening, setListening] = useState(false);
  // A column was named and the task has not arrived yet. "Owe me", then a
  // think. The app already waits through that pause rather than ending the
  // sentence — but it said "pause when you have finished", which is the wrong
  // instruction at the one moment it matters: nothing has been started, let
  // alone finished, and the silence it is forgiving looks identical to the
  // silence that ends a sentence.
  const [awaitingTask, setAwaitingTask] = useState(false);
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
        // Only what was actually said. Stamping the current moment here made a
        // date that looked chosen, and the store's own stamp is a millisecond
        // later — near enough to pass by luck and far enough to fail by it.
        date: parsed.date || undefined,
        dueDate: parsed.dueDate || undefined,
        dueTime: parsed.dueTime || '',
        tz: parsed.dueTime ? deviceZone() : '',
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
  // Restarts of any kind, which is the number that actually has to be bounded.
  const restarts = useRef(0);
  // What earlier sessions of this same dictation left behind, and what the
  // current one has heard. Kept apart because only the second is rebuilt from
  // scratch on every result — see onresult.
  const carried = useRef('');
  const thisRun = useRef('');
  // One dictation, one task. Both halves are needed: the run this recogniser
  // belongs to, so an abandoned one cannot speak for the current one, and
  // whether that run has already had its say.
  const runId = useRef(0);
  const submitted = useRef(false);
  const pressAt = useRef(0);
  // How many extra pauses a command with no task after it has been given.
  const commandWaits = useRef(0);

  // Only ever called on a recogniser that is still live, because the reference
  // is dropped the moment one ends. That distinction is not cosmetic: on a
  // phone the engine is a single shared module and abort() is its global stop,
  // so aborting a recogniser that has already finished reaches past it and
  // stops whatever the module is doing next. Which is what happened — the
  // first dictation after opening the app worked, because there was nothing
  // stale to tear down, and every one after it was aborted by the corpse of
  // the one before.
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
    const Engine = speechEngine();
    if (!Engine) return;
    teardown(recognitionRef.current);

    if (!resuming) {
      // Dictation adds to what is in the box rather than replacing it, so a
      // line half typed is not thrown away by reaching for the microphone.
      base.current = text.trim();
      spoken.current = '';
      carried.current = '';
      thisRun.current = '';
      emptyRestarts.current = 0;
      restarts.current = 0;
      submitted.current = false;
      runId.current += 1;
      commandWaits.current = 0;
      setAwaitingTask(false);
      setSpeechError('');
    }

    // Which dictation this recogniser belongs to. A restart keeps the number;
    // a fresh press does not, which is what lets an abandoned recogniser be
    // recognised as abandoned when it finally ends.
    const myRun = runId.current;

    const r = new Engine();
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
      silenceTimer.current = setTimeout(() => {
        // Everything said so far. If it routes somewhere and names nothing,
        // the sentence is half finished and the pause is a person thinking,
        // not a person stopping.
        const said = joinSpeech(base.current, spoken.current);
        const unfinished =
          said.trim().length > 0 && parseNaturalLanguage(said).title.trim().length === 0;

        if (unfinished && commandWaits.current < COMMAND_WAITS) {
          commandWaits.current += 1;
          armSilence();
          return;
        }
        stopListening();
      }, SILENCE_MS);
    };

    const show = interim => {
      const display = joinSpeech(joinSpeech(base.current, spoken.current), interim);
      setText(display);
      const read = display.trim().length > 2 ? parseNaturalLanguage(display) : null;
      setPreview(read);
      // Said where it goes, not yet what it is. Read from the parser rather
      // than matched against a list of command words here, so the two cannot
      // drift: whatever it treats as routing is what this waits on.
      setAwaitingTask(!!read && read.commanded && read.title.trim() === '');
    };

    let started = false;
    r.onstart = () => { started = true; setListening(true); armSilence(); };

    // Rebuilt from the whole event rather than added to, which is the only
    // reading that is right on both engines.
    //
    // A browser sends the results it has, with resultIndex pointing at the
    // first that changed, so appending from that index works. A phone sends,
    // every single time, one result at index zero holding the entire
    // transcript so far:
    //
    //     resultIndex: 0,
    //     results: [ new Result(isFinal, alternatives) ]
    //
    // Appending that means appending the whole sentence again at every event,
    // and on iOS 18 nearly every event is flagged final — so "Call Bob at 8 PM"
    // arrived as "Call Bob Call Bob at 8 PM Call Bob at 8 PM".
    //
    // Reading every result from the start costs nothing and is correct for
    // both: a browser's list is the whole session, a phone's is the whole
    // transcript. What a restart left behind is kept separately, because that
    // is the one thing no event can tell us.
    r.onresult = e => {
      let finals = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const said = e.results[i][0].transcript;
        if (e.results[i].isFinal) finals = joinSpeech(finals, said);
        else interim = joinSpeech(interim, said);
      }
      thisRun.current = finals;
      spoken.current = joinSpeech(carried.current, thisRun.current);
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
      setAwaitingTask(false);
      // A browser normally follows an error with an end of its own, which
      // releases the microphone. Not every one does, and a microphone left open
      // after a failure is the worst of both — no dictation, and the recording
      // indicator still lit. So end it here rather than assume.
      try { r.abort(); } catch { /* already finished */ }
      if (recognitionRef.current === r) recognitionRef.current = null;
    };

    r.onend = () => {
      clearTimeout(silenceTimer.current);
      // Spent. Held on to, it becomes the thing that stops the next one.
      if (recognitionRef.current === r) recognitionRef.current = null;

      // A recogniser from a dictation that is already over. It has nothing to
      // say about this one, and letting it speak is how one sentence became
      // four tasks.
      if (myRun !== runId.current) return;

      // Whatever this session heard is now settled. Moved across before any
      // restart, because the next session's results replace thisRun entirely.
      carried.current = joinSpeech(carried.current, thisRun.current);
      thisRun.current = '';
      spoken.current = carried.current;

      // Ended on its own while still wanted. Safari does this constantly, and
      // treating it as the end of the sentence is what made dictation feel like
      // it was not listening: you were still talking and it had already gone.
      if (wants.current) {
        if (spoken.current) emptyRestarts.current = 0;
        else emptyRestarts.current += 1;
        restarts.current += 1;
        if (emptyRestarts.current <= MAX_EMPTY_RESTARTS && restarts.current <= MAX_RESTARTS) {
          setTimeout(() => { if (wants.current) startListening(true); }, 120);
          return;
        }
        wants.current = false;
      }

      setListening(false);
      setAwaitingTask(false);
      // Once. A dictation that ends twice is still one thing somebody said.
      if (submitted.current) return;
      submitted.current = true;
      const said = joinSpeech(base.current, spoken.current);
      setTimeout(() => { if (said.trim()) submitRef.current(said); }, 120);
    };

    try {
      r.start();
    } catch {
      // Only a browser throws here, and only for a double start.
    }

    // Nothing at all is the failure that has no symptom. Said out loud rather
    // than left as a button that does nothing, because a silent dead
    // microphone is how the last one went unnoticed for a whole build.
    setTimeout(() => {
      if (started || !wants.current || recognitionRef.current !== r) return;
      wants.current = false;
      clearTimeout(silenceTimer.current);
      setListening(false);
      setAwaitingTask(false);
      recognitionRef.current = null;
      setSpeechError('Dictation did not start — tap the microphone again');
    }, START_GRACE_MS);
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
    // A browser is asked for the microphone by being asked to listen; a phone
    // has to be asked first, and says nothing useful if it is not.
    withSpeechPermission(
      () => startListening(),
      () => setSpeechError(SPEECH_ERROR['not-allowed'])
    );
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
        {/* Only where there is something behind it — a button that renders and
            does nothing when tapped is worse than none. In a browser that is
            the browser's own engine; on a phone it is Apple's, reached through
            a native module, and a build without that module has no button and
            no error. Which of those is the case is said in Account → This
            device, because on screen the two are the same absence. */}
        {speechEngine() ? (
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
            {awaitingTask
              ? 'Listening — now say the task'
              : latched.current
                ? 'Listening — pause when you have finished'
                : 'Listening — let go to add it'}
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

      {/* Shown while listening as well as after it.
          Hiding it during dictation meant the one thing worth seeing was
          invisible at the one moment it mattered: whether the words that choose
          the column were heard as those words. A mishearing is obvious the
          instant it is on the screen and impossible to catch if it is not. */}
      {preview && !processing && text.trim().length > 2 && (
        <View style={st.previewRow}>
          <Text style={st.previewText} numberOfLines={1}>
            {preview.title || (listening ? 'Listening…' : '')}
          </Text>
          {/* Which list this is heading for, before it is committed — the
              routing is inferred from the wording, so it has to be visible. */}
          {preview.taskType === 'done_for_me' ? (
            <Text style={st.tag}>
              {preview.owePerson ? `Owe Me · ${preview.owePerson}` : 'Owe Me'}
            </Text>
          ) : null}
          {/* Said out loud too. Owe Me announced itself and To Do did not, so
              there was no way to tell a command that had been understood from
              one that had been misheard and quietly left in the title. */}
          {preview.taskType !== 'done_for_me' && preview.commanded ? (
            <Text style={st.tag}>To Do</Text>
          ) : null}
          {/* The date it understood, named rather than categorised.
              This used to say "week", which tells you a page and not a day —
              so "Monday the 28th" heard as the wrong Monday looked exactly like
              the right one, and you found out on Monday. The whole point of a
              preview is that a mishearing is caught before the task exists, and
              a date is the easiest thing in a sentence to mishear. */}
          {preview.hasDate && whenPreview(preview.dueDate, preview.dueTime) ? (
            <Text style={st.tag}>{whenPreview(preview.dueDate, preview.dueTime)}</Text>
          ) : null}
          {preview.hasDate && <Text style={st.tag}>{preview.viewScope}</Text>}
          {/* Before the task exists, which is the cheapest moment to find out.
              Said in the same row as the date it would land on, because the two
              are one thought: eleven o'clock on Thursday, and Thursday at
              eleven is the board call. */}
          {diary && clashNote(diary.events, preview.dueDate, preview.dueTime) ? (
            <Text style={[st.tag, st.clash]} dataSet={{ clash: 'true' }}>
              {clashNote(diary.events, preview.dueDate, preview.dueTime)}
            </Text>
          ) : null}
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
  clash: { color: COLORS.accent, fontStyle: 'italic' },
  creating: { fontFamily: SANS, fontSize: 11.5, color: COLORS.inkFaint, paddingTop: 6 },
});
