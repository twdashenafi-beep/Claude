import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';

export default function VoiceRecorder({ onRecordingComplete, existingUri, onDelete }) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const recordingRef = useRef(null);
  const soundRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
    } catch (err) {
      console.log('Failed to start recording:', err);
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;

    clearInterval(timerRef.current);
    setIsRecording(false);

    try {
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (uri && onRecordingComplete) {
        onRecordingComplete(uri, duration);
      }
    } catch (err) {
      console.log('Failed to stop recording:', err);
    }
  };

  const playRecording = async (uri) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync({ uri });
      soundRef.current = sound;
      setIsPlaying(true);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          setIsPlaying(false);
        }
      });

      await sound.playAsync();
    } catch (err) {
      console.log('Failed to play:', err);
      setIsPlaying(false);
    }
  };

  const stopPlayback = async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      setIsPlaying(false);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Show existing recording playback
  if (existingUri) {
    return (
      <View style={st.existing}>
        <TouchableOpacity
          style={st.playBtn}
          onPress={() => isPlaying ? stopPlayback() : playRecording(existingUri)}
          activeOpacity={0.6}
        >
          <Text style={st.playIcon}>{isPlaying ? '⏹' : '▶'}</Text>
        </TouchableOpacity>
        <Text style={st.existingLabel}>Voice note</Text>
        {onDelete && (
          <TouchableOpacity onPress={onDelete} style={st.deleteBtn}>
            <Text style={st.deleteText}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Recording UI
  if (isRecording) {
    return (
      <TouchableOpacity
        style={st.recordingRow}
        onPressOut={stopRecording}
        activeOpacity={0.8}
      >
        <View style={st.recordDot} />
        <Text style={st.recordTime}>{formatTime(duration)}</Text>
        <Text style={st.recordHint}>Release to stop</Text>
      </TouchableOpacity>
    );
  }

  // Idle mic button
  return (
    <TouchableOpacity
      style={st.micBtn}
      onLongPress={startRecording}
      delayLongPress={200}
      activeOpacity={0.6}
    >
      <Text style={st.micIcon}>🎙</Text>
      <Text style={st.micLabel}>Hold to record</Text>
    </TouchableOpacity>
  );
}

// Standalone playback button for task list
export function VoicePlayButton({ uri }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const soundRef = useRef(null);

  useEffect(() => {
    return () => {
      if (soundRef.current) soundRef.current.unloadAsync();
    };
  }, []);

  const toggle = async () => {
    try {
      if (isPlaying && soundRef.current) {
        await soundRef.current.stopAsync();
        setIsPlaying(false);
        return;
      }

      if (soundRef.current) await soundRef.current.unloadAsync();
      const { sound } = await Audio.Sound.createAsync({ uri });
      soundRef.current = sound;
      setIsPlaying(true);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) setIsPlaying(false);
      });

      await sound.playAsync();
    } catch (err) {
      console.log('Playback error:', err);
      setIsPlaying(false);
    }
  };

  return (
    <TouchableOpacity onPress={toggle} style={st.listMic} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Text style={[st.listMicIcon, isPlaying && st.listMicPlaying]}>🎙</Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  micBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
  },
  micIcon: { fontSize: 18 },
  micLabel: { fontSize: 14, color: '#8E8E93' },

  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFF0F0',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  recordDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30',
  },
  recordTime: { fontSize: 18, fontWeight: '700', color: '#FF3B30', fontVariant: ['tabular-nums'] },
  recordHint: { fontSize: 13, color: '#8E8E93', flex: 1, textAlign: 'right' },

  existing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
  },
  playBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center',
  },
  playIcon: { fontSize: 14, color: '#FFF' },
  existingLabel: { flex: 1, fontSize: 14, color: '#000', fontWeight: '500' },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  deleteText: { fontSize: 13, color: '#FF3B30' },

  listMic: { marginLeft: 6 },
  listMicIcon: { fontSize: 14 },
  listMicPlaying: { opacity: 0.5 },
});
