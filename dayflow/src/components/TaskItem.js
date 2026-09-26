import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder,
  useWindowDimensions,
} from 'react-native';
import { VoicePlayButton } from './VoiceRecorder';
import { latestNote } from '../services/voiceNotes';
import { Platform } from 'react-native';
import { dueLabel, dueSpoken } from '../services/due';
import { ageLabel } from '../services/age';
import { repeatPhrase } from '../services/repeat';
import { chaseLabel } from '../services/chase';
import { COLORS, SANS, SERIF } from '../utils/theme';
import { liftTick, dropTick } from '../services/haptics';

// Holding a finger on a row otherwise selects the text under it and raises the
// callout menu, which is what a long press means everywhere else on a page.
//
// touch-action is the delicate one, and it is deliberately not on the row at
// rest. Telling the browser that a row's touches are ours would take every
// vertical swipe away from the page scroll, and a list that cannot be scrolled
// is worse than one that cannot be reordered. It is switched on only once a row
// has actually been picked up — by then the finger has been still for a fifth
// of a second, so no scroll has begun for it to interrupt.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const id = 'dayflow-drag-style';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      [data-taskrow] {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }
      [data-taskrow][data-lifted="true"] {
        touch-action: none;
        cursor: grabbing;
      }`;
    document.head.appendChild(style);
  }
}

// An entry in one of the two columns. The column is narrow, so the title takes
// the full width and everything else — who owes, how much, when — sits on a
// second line beneath it rather than competing for the same row.
function TaskItem({
  task, onToggle, onDelete, onPress,
  onMeasure, onDragStart, onDragMove, onDragEnd, dragging, shift = 0, drift = 0,
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // PanResponder.create runs once, so its handlers close over the props as they
  // were at mount. Both of the callbacks below are rebuilt whenever the task
  // list changes — reordering reads the list to find where a row currently sits,
  // deleting reads it to remember what was removed — so calling the captured
  // versions acts on a list that has since moved on. Reading them from a ref
  // keeps the gesture on the current ones.
  const latest = useRef({});
  useEffect(() => {
    latest.current = { onDelete, onDragStart, onDragMove, onDragEnd };
  });

  useEffect(() => {
    Animated.timing(opacityAnim, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, []);

  // How long the row has to be held before it comes up off the page. Long
  // enough that scrolling never lifts anything by accident, short enough that
  // it does not feel like waiting.
  const LIFT_MS = 220;
  // Movement before then means you are scrolling, not picking anything up.
  const SETTLED = 8;

  const [lifted, setLifted] = useState(false);
  const isLifted = useRef(false);
  const holding = useRef(null);
  const claimed = useRef(false);

  // The finger's travel on its own. The row also has to answer for the page
  // moving underneath it, which is what drift carries.
  const lastDy = useRef(0);

  const cancelLift = useCallback(() => {
    clearTimeout(holding.current);
    holding.current = null;
    if (!isLifted.current) return;
    isLifted.current = false;
    setLifted(false);
  }, []);

  const armLift = useCallback(() => {
    clearTimeout(holding.current);
    claimed.current = false;
    holding.current = setTimeout(() => {
      isLifted.current = true;
      setLifted(true);
      liftTick();
    }, LIFT_MS);
  }, []);

  // One responder, because there is now one thing being touched.
  //
  // It used to be two: a swipe-to-delete on the row and a drag on a handle
  // beside it. The handle was ten points wide on a phone — Apple asks for
  // forty-four — holding six two-pixel dots the colour of the paper, which made
  // reordering a test of aim rather than a gesture. The row is the handle now,
  // so there is nothing to hit.
  //
  // What it must not do is claim the touch at the start. Owning the gesture
  // from the first contact is what would take every vertical swipe away from
  // the page scroll, and a list you cannot scroll is worse than one you cannot
  // reorder. So the start is only watched — the capture handler arms a timer
  // and deliberately declines — and the responder is claimed later, once the
  // hold has been held or the swipe has gone far enough sideways to be one.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => { armLift(); return false; },
      onMoveShouldSetPanResponder: (_, gs) => {
        // Claimed here rather than in the grant below, which is too late.
        // Taking the responder terminates the touchable underneath, and that
        // termination arrives as a press-out — which would put the row back
        // down a moment before the drag it was raised for actually begins.
        if (isLifted.current) { claimed.current = true; return true; }
        // Moving before the hold completes is a scroll or a swipe, not a lift.
        if (Math.abs(gs.dx) > SETTLED || Math.abs(gs.dy) > SETTLED) cancelLift();
        return Math.abs(gs.dx) > 24 && Math.abs(gs.dx) > Math.abs(gs.dy) * 2;
      },
      onPanResponderGrant: () => {
        if (!isLifted.current) return;
        dragY.setValue(0);
        const { onDragStart: start } = latest.current;
        start && start(task.id);
      },
      onPanResponderMove: (_, gs) => {
        if (isLifted.current) {
          lastDy.current = gs.dy;
          dragY.setValue(gs.dy + driftRef.current);
          const { onDragMove: move } = latest.current;
          // moveY is where the finger is on the screen, which is what decides
          // whether the page needs to come with it.
          move && move(gs.dy, gs.moveY);
          return;
        }
        if (gs.dx < 0) translateX.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (isLifted.current) {
          dragY.setValue(0);
          cancelLift();
          claimed.current = false;
          dropTick();
          const { onDragEnd: end } = latest.current;
          end && end();
          return;
        }
        if (gs.dx < -90) {
          Animated.timing(translateX, { toValue: -400, duration: 160, useNativeDriver: true })
            .start(() => latest.current.onDelete(task.id));
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        if (isLifted.current) {
          dragY.setValue(0);
          cancelLift();
          claimed.current = false;
          const { onDragEnd: end } = latest.current;
          end && end();
          return;
        }
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  // Letting go without ever moving never reaches the responder, because the
  // responder was never claimed. This is where a hold that came to nothing is
  // put down.
  const releaseWithoutDrag = () => { if (!claimed.current) cancelLift(); };

  // Edge scrolling moves the page without the finger moving at all, so the row
  // has to be told. Without this it slides out from under the thumb the moment
  // the page starts travelling.
  const driftRef = useRef(0);
  useEffect(() => {
    driftRef.current = drift;
    if (dragging) dragY.setValue(lastDy.current + drift);
  }, [drift, dragging]);

  // Opening a task is the commonest thing anybody does here, and it used to
  // wait three hundred milliseconds before doing it — every tap, on every
  // device, watching for a second tap that would have marked the task done
  // instead.
  //
  // That second way of finishing a task was never needed: the checkbox has
  // always been there, one tap, and a bigger target than the row. So the whole
  // row was being slowed down permanently to support a gesture that duplicated
  // the control beside it. Taking the gesture away is what makes opening
  // instant — the improvement is the deletion.
  const handleTap = () => { onPress && onPress(task); };

  // On a phone the two columns leave a title about a hundred points of width,
  // which is a dozen characters a line — "Call the letting agent about the
  // deposit" was arriving as "Call the letting agent about the…". Below the
  // fold there is nothing but empty sheet, so the room to spend is vertical.
  const { width } = useWindowDimensions();
  const narrow = width < 480;

  const done = task.completed;
  // Who it is with, and when it is due — what you need in order to chase it.
  //
  // The date half used to be the bare time, which said the same thing for a
  // task due this evening and one that was due a fortnight ago.
  const due = done ? null : dueLabel(task);
  // How long this has been sitting. One slot, and the column it is in decides
  // what it means: in Owe Me somebody has had it for three weeks, in To Do you
  // have carried it for three weeks. Both said nothing at all about time
  // before, so one raised this morning and one raised in July read alike.
  const age = done ? null : ageLabel(task);
  // A repeating task reappears on its own, which is unnerving if the row never
  // said it would. Quiet, in the same italic as everything else here: the row
  // is not raising its voice about it, only accounting for itself.
  // Whether you have already asked, next to how long it has been waiting —
  // because "waiting three weeks" reads the same the day before you chase and
  // the day after, and those are not the same situation.
  const meta = [
    done ? null : chaseLabel(task),
    task.owePerson || null,
    done ? null : repeatPhrase(task),
  ].filter(Boolean);

  return (
    <Animated.View style={{ opacity: opacityAnim }}>
      <Animated.View
        dataSet={{ taskrow: 'true', lifted: lifted ? 'true' : 'false' }}
        onLayout={e => onMeasure && onMeasure(task.id, e.nativeEvent.layout.height)}
        style={[
          st.row,
          // The row being dragged rides above the rest and follows the finger;
          // the others slide by a whole row to show where it will land.
          dragging && st.rowDragging,
          // Held long enough to have come up, but not yet moved. Without this
          // the only way to know the row is yours is to move it and find out.
          lifted && !dragging && st.rowLifted,
          { transform: [{ translateX }, { translateY: dragging ? dragY : shift }] },
        ]}
        {...panResponder.panHandlers}
      >
        {/* The box you can see is fifteen pixels; the box you can hit is not.
            hitSlop does that on a phone and nothing at all on the web, which is
            where this app is actually used — so the target is made of padding,
            and taken back out of the layout with the margins, leaving the tick
            exactly where it was. */}
        <TouchableOpacity
          style={st.checkHit}
          onPress={() => onToggle(task.id)}
          activeOpacity={0.6}
          accessibilityRole="checkbox"
          aria-checked={done}
          accessibilityLabel={done ? `Mark ${task.title} as not done` : `Mark ${task.title} as done`}
        >
          <View style={[st.check, done && st.checkDone]}>
            {done && <Text style={st.checkMark}>✓</Text>}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={st.body}
          onPress={handleTap}
          onPressOut={releaseWithoutDrag}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={[
            task.title,
            task.owePerson ? `waiting on ${task.owePerson}` : null,
            dueSpoken(task),
            age ? age.text : null,
            done ? null : chaseLabel(task),
            done ? null : repeatPhrase(task),
            task.priority === 'high' ? 'high priority' : null,
            done ? 'completed' : null,
          ].filter(Boolean).join(', ')}
          accessibilityHint="Opens the task. Hold to pick it up and move it."
        >
          <Text style={[st.title, done && st.titleDone]} numberOfLines={narrow ? 3 : 2}>
            {!done && task.priority === 'high' ? (
              <Text style={st.priority}>! </Text>
            ) : null}
            {task.title}
          </Text>

          {meta.length > 0 || due || age ? (
            <Text style={[st.meta, done && st.metaDone]} numberOfLines={narrow ? 2 : 1}>
              {/* Late is the only thing on a row allowed to raise its voice.
                  Everything else here is the same quiet italic, so the one word
                  that needs finding can be found by colour alone. */}
              {due ? (
                <Text style={due.late ? st.late : null}>{due.text}</Text>
              ) : null}
              {due && (age || meta.length > 0) ? '  ·  ' : ''}
              {age ? (
                <Text style={age.stale ? st.late : null}>{age.text}</Text>
              ) : null}
              {age && meta.length > 0 ? '  ·  ' : ''}
              {meta.join('  ·  ')}
            </Text>
          ) : null}
        </TouchableOpacity>

        {/* One button, and it plays the most recent note: the oldest is
            usually the dictation that made the task, and anything added since
            was added because it had more to say. */}
        {latestNote(task) ? <VoicePlayButton uri={latestNote(task)} /> : null}

        {/* Removing something you are no longer going to do is not the same as
            finishing it, and it was only reachable by swiping or holding —
            neither of which a mouse discovers. */}
        <TouchableOpacity
          style={st.remove}
          onPress={() => onDelete(task.id)}
          hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${task.title}`}
          accessibilityHint="Removes the task without marking it done. Can be undone."
        >
          <Text style={st.removeMark}>×</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 9,
    backgroundColor: COLORS.sheet,
  },
  rowDragging: {
    zIndex: 10,
    shadowColor: '#3B3628', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16, shadowRadius: 10, elevation: 4,
  },

  // Picked up, but not yet moved. The paper lifts a little; nothing else about
  // the row changes, because it is still the row you were reading.
  rowLifted: {
    backgroundColor: '#00000008',
    shadowColor: '#3B3628', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 6, elevation: 2,
  },
  checkHit: {
    alignSelf: 'flex-start',
    // Every margin stated on its own side, and none of them through a
    // shorthand. React Native resolves marginTop over marginVertical by
    // specificity rather than by which is written last, so `marginTop: 3` next
    // to `marginVertical: -11` left the top margin at 3 and the row ten pixels
    // taller than it had been — enough that a drag measured in rows landed one
    // row short.
    //
    // The top is the padding less the three pixels the box used to sit down by;
    // the bottom is the rest of the padding. The ten to the right of the box
    // are padding too, not a margin on top of it: having both moved every row
    // in the app ten pixels across.
    marginTop: -8, marginBottom: -10, marginLeft: -10,
    paddingVertical: 11, paddingHorizontal: 10,
  },
  check: {
    width: 15, height: 15, borderRadius: 2,
    borderWidth: 1, borderColor: '#B5AFA1',
    justifyContent: 'center', alignItems: 'center',
  },
  checkDone: { backgroundColor: COLORS.check, borderColor: COLORS.check },
  checkMark: { fontSize: 10, color: COLORS.sheet, fontWeight: '700', marginTop: -1 },

  // Same trick as the checkbox: a row of one short line is nineteen pixels of
  // text, and opening a task is the commonest thing anybody does here.
  body: { flex: 1, paddingVertical: 9, marginVertical: -9 },
  priority: { fontFamily: SERIF, fontWeight: '700', color: COLORS.accent },
  title: { fontFamily: SANS, fontSize: 14.5, lineHeight: 19, color: COLORS.ink },
  titleDone: { color: COLORS.done, textDecorationLine: 'line-through' },
  meta: {
    fontFamily: SERIF, fontSize: 12, fontStyle: 'italic', color: COLORS.inkSoft,
    marginTop: 2, fontVariant: ['tabular-nums'],
  },
  metaDone: { color: COLORS.done },
  late: { color: COLORS.accent, fontStyle: 'normal', fontWeight: '700' },

  // Faint until reached for: present on every row, but the checkbox is what
  // the eye should land on.
  remove: {
    // No fixed width: box-sizing is border-box here, so `width: 20` ate the
    // padding meant to make this hittable and left it twenty pixels across.
    minWidth: 20, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-start',
    // The width is taken from the right, where there is nothing but the edge of
    // the row. Taking it from the left put this button on top of the one that
    // plays a voice note: the click went to the delete instead, and Playwright
    // spent thirty seconds telling me so in the politest possible terms.
    paddingVertical: 10, paddingLeft: 2, paddingRight: 16,
    // Nineteen tall once the margins are taken off, the same as the row's other
    // two children, so the row is the height it always was.
    marginTop: -8, marginBottom: -12, marginLeft: 2, marginRight: -16,
  },
  removeMark: { fontFamily: SANS, fontSize: 17, lineHeight: 19, color: '#C4BEB0' },
});

// Rendered only when something about this row changed.
//
// Without this, anything that re-rendered the page re-rendered every row in
// both columns — closing a task sheet went from twenty milliseconds at twenty
// tasks to three hundred at two hundred, on a desktop, which on a phone is most
// of a second of the screen sitting still after you have tapped Cancel.
//
// A shallow comparison is enough because the props are stable by construction:
// a task object keeps its identity unless that task is edited, and everything
// else passed in is either a primitive or a callback that does not change.
export default React.memo(TaskItem);
