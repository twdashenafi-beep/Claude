import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  useAudioRecorder, useAudioPlayer, useAudioPlayerStatus,
  setAudioModeAsync, requestRecordingPermissionsAsync, RecordingPresets,
} from 'expo-audio';
import { COLORS, SANS } from '../utils/theme';
import { toDurableUri } from '../services/audio';

// Voice notes, on expo-audio.
//
// expo-av, which this used before, is deprecated and scheduled for removal —
// voice notes would have broken on the next SDK upgrade. The replacement is
// hook-based rather than imperative: the recorder and player are objects owned
// by the component tree, so there is no create/unload lifecycle to get wrong.

// Long enough to say what the task is really about, short enough that the vault
// it shares with every typed task does not fill up with one of them.
const MAX_SECONDS = 60;

export default function VoiceRecorder({ onRecordingComplete, existingUri, onDelete }) {
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
      if (!recorder.uri || !onRecordingComplete) return;

      // What the recorder hands back is only valid where it was made — on the
      // web, in this one tab, until the next refresh. Turn it into the
      // recording itself before it is attached to anything.
      const durable = await toDurableUri(recorder.uri);
      if (durable === null) {
        setProblem('That was too long to keep — try a shorter one');
        return;
      }
      setProblem('');
      onRecordingComplete(durable, duration);
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

  const formatTime = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  if (existingUri) {
    return (
      <View style={st.existing}>
        <VoicePlayButton uri={existingUri} />
        <Text style={st.existingLabel}>Voice note</Text>
        {onDelete ? (
          <TouchableOpacity onPress={onDelete} style={st.deleteBtn}>
            <Text style={st.deleteText}>Remove</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // One button, whatever it is currently saying.
  //
  // It used to be two — a mic, and a separate recording row that replaced it
  // the instant recording began. That swap happened in the middle of your
  // press, so the element you were holding unmounted and the one that took its
  // place had never been pressed. Releasing therefore did nothing at all: the
  // row said "Release to stop" and releasing did not stop it, which is a promise
  // the app was in no position to keep. Recording only ever ended if you pressed
  // the row a second time, and nothing said so.
  //
  // Keeping one element through the whole gesture is the fix. React holds the
  // same instance, so it is still the responder when your finger comes up and
  // onPressOut fires where it never used to. A second press stopping it still
  // works — that is the same handler — so the accidental habit anybody formed
  // is not taken away from them.
  return (
    <TouchableOpacity
      style={isRecording ? st.recordingRow : st.micBtn}
      onLongPress={startRecording}
      delayLongPress={200}
      // Read from the ref rather than the state: this closure is the one the
      // press began with, and the state it captured said "not recording".
      onPressOut={() => { if (recording.current) stopRecording(); }}
      activeOpacity={isRecording ? 0.8 : 0.6}
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
    </TouchableOpacity>
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
