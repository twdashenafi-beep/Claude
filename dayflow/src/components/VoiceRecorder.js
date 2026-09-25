import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, Platform } from 'react-native';
import {
  useAudioRecorder, useAudioPlayer, useAudioPlayerStatus,
  setAudioModeAsync, requestRecordingPermissionsAsync, RecordingPresets,
} from 'expo-audio';
import { COLORS, SANS } from '../utils/theme';
import { toDurableUri, tooShort } from '../services/audio';
import { canAddNote } from '../services/voiceNotes';
import { claim, release } from '../services/playback';
import { liftTick, dropTick } from '../services/haptics';

// Voice notes, on expo-audio.
//
// expo-av, which this used before, is deprecated and scheduled for removal —
// voice notes would have broken on the next SDK upgrade. The replacement is
// hook-based rather than imperative: the recorder and player are objects owned
// by the component tree, so there is no create/unload lifecycle to get wrong.

// Holding a finger on anything in a browser eventually selects what is under it
// and raises the callout menu. That is fine everywhere else in the app; on the
// one control whose entire purpose is being held down for up to a minute, it is
// the gesture being taken away mid-sentence.
//
// touch-action goes on too, which is a bigger claim: a swipe that begins on
// these forty-four pixels will no longer scroll the sheet. It has to. Without
// it the browser treats the upward slide that locks the recording as a scroll,
// takes the touch back, and the recording ends on the way up — which is the
// same failure, from the same cause, as the one that made holding the mic in a
// scrolled sheet produce silent three-millisecond notes. Everywhere but this
// button, scrolling wins.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const id = 'dayflow-voice-style';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      [data-voicebtn] {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        touch-action: none;
      }`;
    document.head.appendChild(style);
  }
}

// Long enough to say what the task is really about, short enough that the vault
// it shares with every typed task does not fill up with one of them.
const MAX_SECONDS = 60;

// A hold rather than a tap, so brushing the mic does not record.
const HOLD_MS = 200;

// Slide the thumb up this far, still holding, and the recording carries on
// without you. Far enough that no ordinary press drifts into it.
const LOCK_DY = 44;

// How far a finger may travel before a press stops looking like a hold. A thumb
// arriving on a small round button is not still — it lands and rolls — and ten
// pixels is inside that roll rather than outside it.
const SETTLE = 24;

const clock = secs => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

export default function VoiceRecorder({ notes = [], onAdd, onRemove }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const timer = useRef(null);
  // Read by the unmount cleanup, which is created once and so cannot see the
  // state.
  const recording = useRef(false);
  // When the finger landed, which is not when the microphone opened.
  //
  // Opening it is awaited — permission, the audio session, preparing the
  // recorder — and on a phone that can eat most of a short hold. Judging a slip
  // by how much audio came back therefore punished the person for the app's own
  // latency: hold for a second on an iPhone, get three hundred milliseconds of
  // sound and be told it was too short. What decides whether a press was meant
  // is how long it lasted, which is this.
  const pressedAt = useRef(0);
  // Said in place of the label when something needs saying, because silently
  // dropping a recording is how you find out a fortnight later — and a button
  // that quietly does nothing is worse still.
  //
  // Toned, because these are not all the same kind of news. "Too short" is a
  // warning about something that did not survive; "ready" is an instruction.
  // Printing both in the red the app reserves for lateness and lost work would
  // make one of them a lie.
  const [problem, setProblem] = useState(null);
  const say = (text, tone = 'warn') => setProblem(text ? { text, tone } : null);
  // Hands-free: the gesture has been let go and the recording is still running.
  const [isLocked, setIsLocked] = useState(false);
  const locked = useRef(false);
  // Whether the finger is still down. Starting is not instant — permission,
  // the audio session and preparing the recorder are all awaited — so a short
  // press can be over before the microphone is open. Without this, the release
  // found nothing to stop and the recording that arrived a moment later ran
  // until the one-minute cap with nobody holding it.
  const wanted = useRef(false);
  // The responder is created once and would otherwise call whichever version of
  // these existed at mount.
  const holdTimer = useRef(null);
  const startRef = useRef(() => {});
  const stopRef = useRef(() => {});
  const lockRef = useRef(() => {});

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
    locked.current = false;
    Promise.resolve()
      .then(() => recorder.stop())
      .then(() => setAudioModeAsync({ allowsRecording: false }))
      .catch(() => {});
  }, [recorder]);

  const startRecording = async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission || !permission.granted) {
        // Said, rather than nothing happening. A button that does absolutely
        // nothing when you hold it is indistinguishable from a broken one, and
        // the reason is not on screen: it is in a dialog you answered a moment
        // ago, or in a settings page two apps away.
        say(permission && permission.canAskAgain === false
          ? 'The microphone is turned off for DayFlow — allow it in Settings'
          : 'Allow the microphone, then hold again');
        return;
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // record() is synchronous, but the recorder has to be prepared first or
      // it starts against nothing.
      await recorder.prepareToRecordAsync();

      // Let go while all that was happening.
      //
      // The first hold of all is the one this is really for. Asking for the
      // microphone puts a system dialog on the screen, and you cannot answer it
      // without lifting your finger off the button — so the very first attempt
      // always ends here, with permission newly granted and nothing recorded.
      //
      // It used to end here saying "Too short — hold while you talk", which is
      // both wrong and rude: the hold was three seconds long and what took the
      // time was the app asking for something. Nothing has been recorded at
      // this point, so there is nothing to discard and nothing to apologise
      // for — only the next move to name.
      if (!wanted.current) {
        await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
        say('Ready — hold to record', 'note');
        return;
      }

      recorder.record();

      recording.current = true;
      setIsRecording(true);
      setDuration(0);
      say('');
      // The screen is under your thumb at this point. The buzz is the part you
      // can perceive.
      liftTick();
      timer.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (err) {
      console.warn('Failed to start recording:', err.message);
    }
  };

  const lockRecording = () => {
    if (!recording.current || locked.current) return;
    locked.current = true;
    setIsLocked(true);
    liftTick();
  };

  const stopRecording = async () => {
    clearInterval(timer.current);
    const held = pressedAt.current ? Date.now() - pressedAt.current : null;
    recording.current = false;
    locked.current = false;
    setIsRecording(false);
    setIsLocked(false);
    try {
      await recorder.stop();
      // Recording holds the audio session; hand it back so playback elsewhere
      // is not routed to the earpiece afterwards.
      await setAudioModeAsync({ allowsRecording: false });
      if (!recorder.uri || !onAdd) return;

      // A hold too brief to have been meant. Said rather than saved, because a
      // quarter-second of room tone looks exactly like a real note in the list
      // and only reveals itself when you play it.
      if (tooShort(held)) {
        say('Too short — hold while you talk');
        return;
      }

      // What the recorder hands back is only valid where it was made — on the
      // web, in this one tab, until the next refresh. Turn it into the
      // recording itself before it is attached to anything.
      const durable = await toDurableUri(recorder.uri);
      if (durable === null) {
        say('That was too long to keep — try a shorter one');
        return;
      }
      say('');
      dropTick();
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
    lockRef.current = lockRecording;
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
  //
  // Sliding up instead locks it. Holding a phone still for a minute to leave a
  // minute-long note is a demand no other recorder makes, and the alternative —
  // a tap to start and a tap to stop — is how you end up with an hour of pocket
  // in a vault measured in megabytes. Slide up and it keeps going; tap it and
  // it stops.
  const gesture = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // The whole point. Without this the sheet takes the gesture back the
      // moment it fancies scrolling, and recording ends before it began.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        clearTimeout(holdTimer.current);
        // Already running, and this is a fresh press: the only way to be here
        // is locked, and the press is the stop.
        if (recording.current) {
          wanted.current = false;
          stopRef.current();
          return;
        }
        wanted.current = true;
        pressedAt.current = Date.now();
        // A hold, not a tap: a brush against the mic should not record.
        holdTimer.current = setTimeout(() => startRef.current(), HOLD_MS);
      },
      onPanResponderMove: (_, gs) => {
        if (!recording.current) {
          // Cancels the hold that has not happened yet, and nothing else.
          //
          // It used to clear `wanted` here as well, which was the same word
          // being used for two different facts: "the finger is still down" and
          // "this still looks like a hold rather than a swipe". A thumb landing
          // on a forty-four pixel button rolls as it settles, and once the hold
          // had already fired, that roll said the finger had gone. Setting up
          // the microphone takes a few hundred milliseconds, and when it
          // finished it found `wanted` false and stood down — so holding the
          // button for three seconds produced "Ready — hold to record" and no
          // recording at all. Whether the finger is down is the release's to
          // say, and only the release's.
          if (Math.abs(gs.dx) > SETTLE || Math.abs(gs.dy) > SETTLE) {
            clearTimeout(holdTimer.current);
          }
          return;
        }
        if (gs.dy < -LOCK_DY) lockRef.current();
      },
      onPanResponderRelease: () => {
        clearTimeout(holdTimer.current);
        wanted.current = false;
        if (recording.current && !locked.current) stopRef.current();
      },
      onPanResponderTerminate: () => {
        clearTimeout(holdTimer.current);
        wanted.current = false;
        if (recording.current && !locked.current) stopRef.current();
      },
    })
  ).current;

  const room = canAddNote(notes);
  const full = !room && !isRecording;

  return (
    <View>
      {/* What is already here. Each one plays and each one can go; the button
          stays underneath, which is the whole of the fix — a task that had a
          note used to show this list and nothing else, so the one recording it
          arrived with was also the last it could ever have. */}
      {notes.map((uri, i) => (
        <NoteRow
          key={`${i}-${uri.slice(-12)}`}
          uri={uri}
          index={i}
          total={notes.length}
          onRemove={onRemove ? () => onRemove(i) : null}
        />
      ))}

      {/* The button sits at the right-hand end, where a thumb already is.
          It used to be at the left margin, under the same hand that has to
          reach across the phone to get to it — fine on a desk, and the one
          control in the app you have to hold down for a minute. What it says
          it will do sits to its left, so the reading order is unchanged. */}
      <View style={st.bar}>
        <View style={st.status}>
          {isRecording ? (
            <>
              <View style={st.recordDot} />
              <Text style={st.recordTime}>
                {clock(duration)} / {clock(MAX_SECONDS)}
              </Text>
              <Text style={st.recordHint} numberOfLines={1}>
                {isLocked ? 'Tap to stop' : 'Slide up to keep going'}
              </Text>
            </>
          ) : (
            <Text
              style={[st.micLabel, problem && problem.tone === 'warn' && st.micProblem]}
              numberOfLines={2}
            >
              {problem ? problem.text : (full
                ? 'That is as many as one task can hold. Remove one to record another.'
                : 'Hold to record')}
            </Text>
          )}
        </View>

        {full ? null : (
          <View
            style={[st.micBtn, isRecording && st.micBtnLive, isLocked && st.micBtnLocked]}
            dataSet={{ voicebtn: 'true' }}
            {...gesture.panHandlers}
            accessibilityRole="button"
            accessibilityLabel={isRecording ? 'Stop recording' : 'Record a voice note'}
            accessibilityHint={
              isRecording
                ? 'Release, or press again, to stop. Slide up to record without holding.'
                : 'Press and hold to record'
            }
          >
            <Text style={isRecording ? st.stopIcon : st.micIcon}>
              {isRecording ? '■' : '🎙'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// Playing one note.
//
// Shared by the row in the list and the row in the sheet, which differ only in
// how much of it they show. Two copies of this drifted apart once already.
function useNotePlayer(uri) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const playing = status?.playing ?? false;

  // A recording made in the browser often carries no length in its metadata —
  // MediaRecorder does not write one — so the length is reported when it is
  // known and left out when it is not, rather than shown as 0:00.
  const length = Number.isFinite(status?.duration) && status.duration > 0 ? status.duration : 0;
  const at = Number.isFinite(status?.currentTime) ? status.currentTime : 0;

  // A stable identity for the registry, calling through to whichever closure
  // the current render made.
  const pause = useRef(() => {});
  pause.current = () => {
    player.pause();
    // Rewind, so the next tap replays rather than resuming from the end.
    player.seekTo(0).catch(() => {});
  };
  const stopMe = useRef((...args) => pause.current(...args)).current;

  // Playing is the only state that holds the floor. Finishing, being stopped by
  // something else, and going away all end the same way.
  useEffect(() => {
    if (!playing) release(stopMe);
  }, [playing, stopMe]);
  useEffect(() => () => release(stopMe), [stopMe]);

  const toggle = () => {
    if (playing) {
      pause.current();
      release(stopMe);
      return;
    }
    // Anything else talking stops here, rather than talking over this.
    claim(stopMe);
    if (status?.didJustFinish) player.seekTo(0).catch(() => {});
    player.play();
  };

  return { playing, at, length, toggle };
}

// One note: a play control, what it is, how long it is, and a way to be rid
// of it.
//
// The whole left-hand side is the play control rather than the small triangle
// alone. A note is the thing on the row a person most wants to touch and it had
// the smallest target on it.
function NoteRow({ uri, index, total, onRemove }) {
  const { playing, at, length, toggle } = useNotePlayer(uri);

  return (
    <View style={st.existing}>
      <TouchableOpacity
        onPress={toggle}
        style={st.noteMain}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Stop voice note' : 'Play voice note'}
      >
        <Text style={[st.listMicIcon, playing && st.listMicPlaying]}>
          {playing ? '⏹' : '▶'}
        </Text>
        <Text style={st.existingLabel}>
          {total > 1 ? `Voice note ${index + 1}` : 'Voice note'}
        </Text>
        {/* Rounded up rather than down. A note of nine-tenths of a second is a
            real note, and "0:00" next to it reads as something broken. */}
        <Text style={st.noteTime}>
          {playing && length ? clock(at) : length ? clock(Math.max(1, Math.round(length))) : ''}
        </Text>
      </TouchableOpacity>
      {onRemove ? (
        <TouchableOpacity
          onPress={onRemove}
          style={st.deleteBtn}
          accessibilityRole="button"
          accessibilityLabel={
            total > 1 ? `Remove voice note ${index + 1}` : 'Remove voice note'
          }
        >
          <Text style={st.deleteText}>Remove</Text>
        </TouchableOpacity>
      ) : null}
      {/* Only while it is playing, and gone the moment it is not. */}
      {playing && length ? (
        <View style={st.progressTrack}>
          <View style={[st.progressFill, { width: `${Math.min(100, (at / length) * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

// Standalone playback for a task row.
export function VoicePlayButton({ uri }) {
  const { playing, toggle } = useNotePlayer(uri);

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
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 6, minHeight: 48,
  },
  status: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },

  // 44 across, which is the smallest thing Apple will call a target and about
  // the size of the thumb that has to hold it down.
  micBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.sheetEdge,
    backgroundColor: COLORS.sheet,
  },
  micBtnLive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  micBtnLocked: { backgroundColor: COLORS.accent, borderColor: COLORS.ink },
  micIcon: { fontSize: 19 },
  stopIcon: { fontSize: 15, color: COLORS.sheet },

  micLabel: { fontFamily: SANS, fontSize: 13.5, color: COLORS.inkFaint },
  micProblem: { color: COLORS.accent },

  recordDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.accent },
  recordTime: {
    fontFamily: SANS, fontSize: 14, color: COLORS.ink, fontVariant: ['tabular-nums'],
  },
  recordHint: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint, flexShrink: 1 },

  existing: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  noteMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  existingLabel: { fontFamily: SANS, fontSize: 13.5, color: COLORS.inkSoft, flex: 1 },
  noteTime: {
    fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint,
    fontVariant: ['tabular-nums'],
  },
  deleteBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  deleteText: { fontFamily: SANS, fontSize: 12.5, color: COLORS.accent },

  progressTrack: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 2,
    backgroundColor: COLORS.rule,
  },
  progressFill: { height: 2, backgroundColor: COLORS.accent },

  // Twelve-point glyph in two pixels of padding came to sixteen by fourteen.
  // It is the only control on a row that is neither the task nor the delete,
  // and it sits between them, so it grows evenly and takes its space back with
  // the margins.
  listMic: {
    paddingHorizontal: 8, paddingVertical: 10,
    marginHorizontal: -6, marginVertical: -10,
    alignItems: 'center', justifyContent: 'center',
  },
  listMicIcon: { fontSize: 12, color: COLORS.inkFaint },
  listMicPlaying: { color: COLORS.accent },
});
