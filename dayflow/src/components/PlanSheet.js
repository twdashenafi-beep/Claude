import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { clockOf, placeable, spanMinutes } from '../services/agenda';
import LaterPicker from './LaterPicker';
import TickBox from './TickBox';
import WhenSheet from './WhenSheet';
import { COLORS, SANS, SERIF, SHEET_MAX_WIDTH, typeSize } from '../utils/theme';

// Putting something in the free time.
//
// The one move this app could describe and never make. It could say the
// afternoon was free and say what was open, and joining those two facts
// happened in somebody's head.
//
// Deliberately not a planner. No dragging, no resizing, no colour-coding, no
// second calendar: a gap, a short list, one tap. The task gets the hour this
// app has always given a task with a time on it, and from then on it is an
// ordinary task that happens to know when it is — it clashes, it reminds, it
// sorts into the day like everything else.

// Enough to choose from, few enough to read. The order does the work: what is
// owed is at the top, so a longer list would be more scrolling rather than
// more choice.
const MOST = 40;

export default function PlanSheet({
  visible, gaps = [], tomorrow = false, chosen, tasks = [], onPlace, onPutOff, onPutOffTo,
  onDone, onOpen, onClose,
}) {
  const [gap, setGap] = useState(null);
  // What the last decision was, said in the sheet because the sheet stays open.
  // Going down a list of twenty is twenty taps, not twenty taps and twenty
  // reopenings, and a confirmation behind a modal is no confirmation at all.
  const here = gap || chosen || gaps[0] || null;

  // Taken once, when the sheet opens, and held.
  //
  // Everything open that is not already committed to an hour still ahead —
  // which includes anything overdue, because rescheduling those is most of
  // what anybody taps the strip for in the evening.
  //
  // Held rather than recomputed, because a row acted on would otherwise vanish
  // the instant it was dealt with, taking its undo with it. A triage pass is
  // over a fixed list: the rows stay, they show what you decided, and you can
  // see how far down you have got. Reopening the sheet takes a fresh one.
  const [free, setFree] = useState([]);
  useEffect(() => {
    if (!visible) return;
    // Which day is being filled, so the list offers what is owed by the end of
    // it and not everything that was ever pushed past it. Any gap will do: they
    // are all on the same day.
    const filling = chosen || gaps[0] || null;
    setFree(placeable(tasks, new Date(), filling ? filling.start : null));
    // Deliberately only on opening: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Which rows have been ticked in this pass. Held here rather than read off the
  // task, for the same reason the list is: a row that reported itself from the
  // live task would contradict the held row it sits on.
  const [ticked, setTicked] = useState({});
  // A list of three hundred is a list nobody reads to the end of. The order
  // puts what is owed first, so the top of it is the part worth showing, and
  // the rest is counted rather than scrolled.
  const shown = free.slice(0, MOST);
  const rest = free.length - shown.length;

  // Which row asked for a calendar, and where to report the answer back to.
  // See DueSheet: the row's picker owns what it says afterwards.
  const [exact, setExact] = useState(null);

  // Android's back button closes one thing at a time. With the calendar
  // open it is the calendar, not the sheet behind it and everything
  // half-decided in it.
  const close = () => {
    if (exact) { setExact(null); return; }
    setGap(null); setTicked({}); onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={close}>
      <View style={s.page}>
        <View style={s.head}>
          <TouchableOpacity onPress={close} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={s.close}>Done</Text>
          </TouchableOpacity>
          <Text style={s.title} accessibilityRole="header">
            {tomorrow ? 'Tomorrow' : 'Free time'}
          </Text>
          <View style={s.balance} />
        </View>

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {gaps.length === 0 ? (
            <Text style={s.blurb}>
              Nothing free is left today, and tomorrow is full.
            </Text>
          ) : (
            <>
              {/* Every gap, so a tap that landed on the wrong one is one more
                  tap to put right rather than a reason to start again. */}
              <View style={s.gaps}>
                {gaps.map(g => {
                  const mine = here && +g.start === +here.start;
                  return (
                    <TouchableOpacity
                      key={String(g.start)}
                      onPress={() => setGap(g)}
                      style={[s.gap, mine && s.gapOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: !!mine }}
                      accessibilityLabel={`Free ${clockOf(g.start)} to ${clockOf(g.end)}`}
                    >
                      <Text style={[s.gapText, mine && s.gapTextOn]}>
                        {`${clockOf(g.start)}–${clockOf(g.end)}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={s.blurb}>
                {here
                  ? `${spanMinutes(Math.round((here.end - here.start) / 60000))} free `
                    + `${tomorrow ? 'tomorrow ' : ''}from ${clockOf(here.start)}. `
                    + 'Tap the time beside something to put it there.'
                  : 'Pick a stretch of free time.'}
              </Text>

              {free.length === 0 ? (
                <Text style={s.empty}>
                  Everything open is already committed to an hour still ahead, so there is
                  nothing left to place.
                </Text>
              ) : (
                shown.map(task => (
                  <View key={task.id} style={s.row}>
                    {/* The question this sheet asks is "shall I do this
                        tomorrow", and it used to take only one answer. The
                        other two are the ones somebody going down a long list
                        actually needs, and they are different decisions: one
                        moves a promise, the other moves a page. */}
                    {/* Going down a list of what is owed, a good share of it
                        is already done or takes a moment — and saying so should
                        not mean opening the task, finishing it and finding your
                        way back to row nine. The same box as the Due sheet,
                        because it is the same decision. */}
                    {onDone ? (
                      <TickBox
                        on={!!ticked[task.id]}
                        title={task.title}
                        tag="plandone"
                        onPress={() => {
                          onDone(task);
                          setTicked(was => ({ ...was, [task.id]: !was[task.id] }));
                        }}
                      />
                    ) : null}
                    {/* The title opens the task, the way a title does
                        everywhere else in this app and on the sheet this one is
                        modelled on. It used to place the task in the gap, which
                        meant a list of titles where tapping a title did
                        something other than open it — and the only sign of what
                        had happened was a banner at the far end of the screen
                        with Undo in it. */}
                    <TouchableOpacity
                      style={s.rowMain}
                      onPress={() => onOpen(task)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${task.title}`}
                      dataSet={{ plantask: 'true' }}
                    >
                      <Text
                        style={[s.rowText, ticked[task.id] && s.rowTextDone]}
                        numberOfLines={2}
                      >
                        {task.title}
                      </Text>
                    </TouchableOpacity>
                    {/* Placing it is now a control of its own, and it says the
                        hour it would use. That is the sheet's whole purpose, so
                        it reads as the answer to the line above: two hours free
                        from 09:00, and here is 09:00 beside everything you
                        could put there. */}
                    {here ? (
                      <TouchableOpacity
                        style={s.at}
                        onPress={() => { onPlace(task, here); setGap(null); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Do ${task.title} at ${clockOf(here.start)}`}
                        dataSet={{ planat: 'true' }}
                      >
                        <Text style={s.atText}>{clockOf(here.start)}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {/* One control, four named answers, and the result
                        shown on the row it belongs to. "Month" is gone from
                        here: moving a page and moving a date are different
                        decisions, and the page one already lives in the
                        task's own sheet under "Show under". */}
                    <LaterPicker
                      onPick={step => onPutOff(task, step)}
                      onExact={onPutOffTo ? report => setExact({ task, report }) : null}
                    />
                  </View>
                ))
              )}
              {rest > 0 ? (
                <Text style={s.more}>
                  {`and ${rest} more — anything not here can be given a time from the task itself`}
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>

        <WhenSheet
          visible={!!exact}
          task={exact ? exact.task : null}
          onSet={(day, time) => {
            if (!exact) return;
            exact.report(onPutOffTo(exact.task, day, time));
          }}
          onClose={() => setExact(null)}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.sheet },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 54, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  close: { fontFamily: SANS, fontSize: typeSize(15.5), color: COLORS.accent },
  title: { fontFamily: SERIF, fontSize: typeSize(18), color: COLORS.ink },
  balance: { width: 44 },
  body: { paddingHorizontal: 20, paddingBottom: 40, maxWidth: SHEET_MAX_WIDTH, width: '100%', alignSelf: 'center' },

  said: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 11, backgroundColor: COLORS.desk,
  },
  saidText: { flex: 1, fontFamily: SANS, fontSize: typeSize(13), color: COLORS.inkSoft, paddingRight: 12 },
  saidUndo: { fontFamily: SANS, fontSize: typeSize(13.5), color: COLORS.accent, marginLeft: 14 },
  saidLast: { marginLeft: 14 },

  gaps: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 18 },
  gap: {
    borderWidth: 1, borderColor: COLORS.rule, borderRadius: 3,
    paddingVertical: 7, paddingHorizontal: 11, marginRight: 8, marginBottom: 8,
  },
  gapOn: { borderColor: COLORS.pencil, backgroundColor: COLORS.pencil },
  gapText: { fontFamily: SANS, fontSize: typeSize(13), color: COLORS.inkSoft },
  gapTextOn: { color: COLORS.sheet },

  blurb: { fontFamily: SANS, fontSize: typeSize(13), color: COLORS.inkSoft, marginTop: 10, marginBottom: 16 },
  empty: { fontFamily: SERIF, fontStyle: 'italic', fontSize: typeSize(14), color: COLORS.inkFaint },
  more: { fontFamily: SANS, fontSize: typeSize(12), color: COLORS.inkFaint, marginTop: 16 },

  row: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  rowMain: { flex: 1, paddingRight: 10 },
  // The hour is the same for every row and is already in the line above, so
  // repeating it beside each one was noise where two decisions now live.
  rowText: { fontFamily: SANS, fontSize: typeSize(15), color: COLORS.ink },
  // The hour, as a control. Bordered like the gap chips above it, because it
  // does the same kind of thing: it names a time and puts something at it.
  at: {
    borderWidth: 1, borderColor: COLORS.rule, borderRadius: 3,
    paddingVertical: 6, paddingHorizontal: 9, marginLeft: 4,
  },
  atText: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent },
  rowTextDone: { color: COLORS.done, textDecorationLine: 'line-through' },
  act: { paddingVertical: 6, paddingHorizontal: 9, marginLeft: 4 },
  actText: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent },
});
