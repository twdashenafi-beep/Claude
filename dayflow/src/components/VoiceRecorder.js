import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder } from 'react-native';
import {
  useAudioRecorder, useAudioPlayer, useAudioPlayerStatus,
  setAudioModeAsync, requestRecordingPermissionsAsync, RecordingPresets,
} from 'expo-audio';
import { COLORS, SANS } from '../utils/theme';
import { toDurableUri } from '../services/audio';
import { MAX_NOTES, canAddNote } from '../services/voiceNotes';

// Voice notes, on expo-audio.
//
// expo-av, which this used before, is deprecated and scheduled for removal —
// voice notes would have broken on the next SDK upgrade. The replacement is
// hook-based rather than imperative: the recorder and player are objects owned
// by the component tree, so there is no create/unload lifecycle to get wrong.

// Long enough to say what the task is really about, short enough that the vault
// it shares with every typed task does not fill up with one of them.
const MAX_SECONDS = 60;

// A hold rather than a tap, so brushing the mic does not record.
const HOLD_MS = 200;

export default function VoiceRecorder({ notes = [], onAdd, onRemove }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const timer = useRef(null);
  // Read by the unmount cleanup, which is created once and so cannot see the
  // state.
  const recording = useRef(false);
  // Said in place of the label when a recording could not be kept, because
  // silently dropping one is how you find out a fortnight later.
  const [problem, setProblem] = useState('');
  // The responder is created once and would otherwise call whichever version of
  // these existed at mount.
  const holdTimer = useRef(null);
  const startRef = useRef(() => {});
  const stopRef = useRef(() => {});

  // Closing the sheet mid-recording has to stop the recording.
  //
  // The counter was already cleared here; the recorder itself was not, so
  // dismissing the sheet while recording left the microphone open and the
  // audio session still in recording mode — which on a phone also routes the
  // next thing you play to the earpiece.
  //
  // The half-finished take is dropped rather than attached: the sheet it
  // belonged to has gone, and there is nothing left to attach it to.
  useEffect(() => () => {
    clearInterval(timer.current);
    if (!recording.current) return;
    recording.current = false;
    Promise.resolve()
      .then(() => recorder.stop())
      .then(() => setAudioModeAsync({ allowsRecording: false }))
      .catch(() => {});
  }, [recorder]);

  const startRecording = async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) return;

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // record() is synchronous, but the recorder has to be prepared first or
      // it starts against nothing.
      await recorder.prepareToRecordAsync();
      recorder.record();

      recording.current = true;
      setIsRecording(true);
      setDuration(0);
      timer.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (err) {
      console.warn('Failed to start recording:', err.message);
    }
  };

  const stopRecording = async () => {
    clearInterval(timer.current);
    recording.current = false;
    setIsRecording(false);
    try {
      await recorder.stop();
      // Recording holds the audio session; hand it back so playback elsewhere
      // is not routed to the earpiece afterwards.
      await setAudioModeAsync({ allowsRecording: false });
      if (!recorder.uri || !onAdd) return;

      // What the recorder hands back is only valid where it was made — on the
      // web, in this one tab, until the next refresh. Turn it into the
      // recording itself before it is attached to anything.
      const durable = await toDurableUri(recorder.uri);
      if (durable === null) {
        setProblem('That was too long to keep — try a shorter one');
        return;
      }
      setProblem('');
      onAdd(durable, duration);
    } catch (err) {
      console.warn('Failed to stop recording:', err.message);
    }
  };

  // A cap, because nothing else stops a pocket from recording for an hour. The
  // take up to this point is kept rather than discarded: it ends the recording,
  // it does not throw it away.
  useEffect(() => {
    if (isRecording && duration >= MAX_SECONDS) stopRecording();
    // stopRecording is redefined every render; what decides this is the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, duration]);

  useEffect(() => {
    startRef.current = startRecording;
    stopRef.current = stopRecording;
  });
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  // One button, whatever it is currently saying, and it keeps the gesture it
  // was given.
  //
  // It used to be two — a mic, and a separate recording row that replaced it
  // the instant recording began. That swap happened in the middle of your
  // press, so the element you were holding unmounted and the one that took its
  // place had never been pressed. Releasing therefore did nothing at all: the
  // row said "Release to stop" and releasing did not stop it. One element
  // through the whole gesture fixed that.
  //
  // It was still a touchable, though, and a touchable inside a scrolling sheet
  // can be taken off you: the scroll view asks for the gesture and the press
  // ends as a press-out. Since a press-out is how recording stops, holding the
  // mic anywhere the sheet had been scrolled started a recording and ended it
  // in the same breath — a voice note a few milliseconds long, with no sign
  // that anything had gone wrong. The sheet grew a section and put the mic
  // below the fold, which is how it was finally noticed.
  //
  // So the gesture is held rather than borrowed: this claims the touch itself
  // and refuses to hand it over. Moving before the hold completes gives it up,
  // so a swipe that happens to begin on the mic is still a swipe.
  const gesture = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // The whole point. Without this the sheet takes the gesture back the
      // moment it fancies scrolling, and recording ends before it began.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        clearTimeout(holdTimer.current);
        // A hold, not a tap: a brush against the mic should not record.
        holdTimer.current = setTimeout(() => startRef.current(), HOLD_MS);
      },
      onPanResponderMove: (_, gs) => {
        if (recording.current) return;
        if (Math.abs(gs.dx) > 10 || Math.abs(gs.dy) > 10) clearTimeout(holdTimer.current);
      },
      onPanResponderRelease: () => {
        clearTimeout(holdTimer.current);
        if (recording.current) stopRef.current();
      },
      onPanResponderTerminate: () => {
        clearTimeout(holdTimer.current);
        if (recording.current) stopRef.current();
      },
    })
  ).current;


  const formatTime = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  const room = canAddNote(notes);

  return (
    <View>
      {/* What is already here. Each one plays and each one can go; the mic
          stays underneath, which is the whole of the fix — a task that had a
          note used to show this list and nothing else, so the one recording it
          arrived with was also the last it could ever have. */}
      {notes.map((uri, i) => (
        <View key={`${i}-${uri.slice(-12)}`} style={st.existing}>
          <VoicePlayButton uri={uri} />
          <Text style={st.existingLabel}>
            {notes.length > 1 ? `Voice note ${i + 1}` : 'Voice note'}
          </Text>
          {onRemove ? (
            <TouchableOpacity
              onPress={() => onRemove(i)}
              style={st.deleteBtn}
              accessibilityRole="button"
              accessibilityLabel={
                notes.length > 1 ? `Remove voice note ${i + 1}` : 'Remove voice note'
              }
            >
              <Text style={st.deleteText}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}

      {!room ? (
        <Text style={st.micLabel}>
          {`That is as many as one task can hold. Remove one to record another.`}
        </Text>
      ) : (
    <View
      style={isRecording ? st.recordingRow : st.micBtn}
      {...gesture.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={isRecording ? 'Stop recording' : 'Record a voice note'}
      accessibilityHint={
        isRecording ? 'Release, or press again, to stop' : 'Press and hold to record'
      }
    >
      {isRecording ? (
        <>
          <View style={st.recordDot} />
          <Text style={st.recordTime}>
            {formatTime(duration)} / {formatTime(MAX_SECONDS)}
          </Text>
          <Text style={st.recordHint}>Release to stop</Text>
        </>
      ) : (
        <>
          <Text style={st.micIcon}>🎙</Text>
          <Text style={[st.micLabel, problem && st.micProblem]}>
            {problem || 'Hold to record'}
          </Text>
        </>
      )}
    </View>
      )}
    </View>
  );
}

// Standalone playback for a task row.
export function VoicePlayButton({ uri }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const playing = status?.playing ?? false;

  const toggle = () => {
    if (playing) {
      player.pause();
      // Rewind, so the next tap replays rather than resuming from the end.
      player.seekTo(0).catch(() => {});
      return;
    }
    if (status?.didJustFinish) player.seekTo(0).catch(() => {});
    player.play();
  };

  return (
    <TouchableOpacity
      onPress={toggle}
      style={st.listMic}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Stop voice note' : 'Play voice note'}
    >
      <Text style={[st.listMicIcon, playing && st.listMicPlaying]}>
        {playing ? '⏹' : '▶'}
      </Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  micBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  micIcon: { fontSize: 17 },
  micLabel: { fontFamily: SANS, fontSize: 13.5, color: COLORS.inkFaint },
  micProblem: { color: COLORS.accent },

  recordingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
  },
  recordDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.accent },
  recordTime: {
    fontFamily: SANS, fontSize: 14, color: COLORS.ink, fontVariant: ['tabular-nums'],
  },
  recordHint: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint },

  existing: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  existingLabel: { fontFamily: SANS, fontSize: 13.5, color: COLORS.inkSoft, flex: 1 },
  deleteBtn: { paddingHorizontal: 4 },
  deleteText: { fontFamily: SANS, fontSize: 12.5, color: COLORS.accent },

  listMic: { paddingHorizontal: 2 },
  listMicIcon: { fontSize: 12, color: COLORS.inkFaint },
  listMicPlaying: { color: COLORS.accent },
});
