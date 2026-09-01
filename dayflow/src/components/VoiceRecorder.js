import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  useAudioRecorder, useAudioPlayer, useAudioPlayerStatus,
  setAudioModeAsync, requestRecordingPermissionsAsync, RecordingPresets,
} from 'expo-audio';
import { COLORS, SANS } from '../utils/theme';

// Voice notes, on expo-audio.
//
// expo-av, which this used before, is deprecated and scheduled for removal —
// voice notes would have broken on the next SDK upgrade. The replacement is
// hook-based rather than imperative: the recorder and player are objects owned
// by the component tree, so there is no create/unload lifecycle to get wrong.

export default function VoiceRecorder({ onRecordingComplete, existingUri, onDelete }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const startRecording = async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) return;

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // record() is synchronous, but the recorder has to be prepared first or
      // it starts against nothing.
      await recorder.prepareToRecordAsync();
      recorder.record();

      setIsRecording(true);
      setDuration(0);
      timer.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (err) {
      console.warn('Failed to start recording:', err.message);
    }
  };

  const stopRecording = async () => {
    clearInterval(timer.current);
    setIsRecording(false);
    try {
      await recorder.stop();
      // Recording holds the audio session; hand it back so playback elsewhere
      // is not routed to the earpiece afterwards.
      await setAudioModeAsync({ allowsRecording: false });
      if (recorder.uri && onRecordingComplete) onRecordingComplete(recorder.uri, duration);
    } catch (err) {
      console.warn('Failed to stop recording:', err.message);
    }
  };

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

  if (isRecording) {
    return (
      <TouchableOpacity style={st.recordingRow} onPressOut={stopRecording} activeOpacity={0.8}>
        <View style={st.recordDot} />
        <Text style={st.recordTime}>{formatTime(duration)}</Text>
        <Text style={st.recordHint}>Release to stop</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={st.micBtn}
      onLongPress={startRecording}
      delayLongPress={200}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel="Record a voice note"
      accessibilityHint="Press and hold to record, release to stop"
    >
      <Text style={st.micIcon}>🎙</Text>
      <Text style={st.micLabel}>Hold to record</Text>
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
