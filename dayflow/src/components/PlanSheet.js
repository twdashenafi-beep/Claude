import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { clockOf, placeable, spanMinutes } from '../services/agenda';
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
  visible, gaps = [], tomorrow = false, chosen, tasks = [],
  onPlace, onPutOff, onToMonth, onClose,
}) {
  const [gap, setGap] = useState(null);
  // What the last decision was, said in the sheet because the sheet stays open.
  // Going down a list of twenty is twenty taps, not twenty taps and twenty
  // reopenings, and a confirmation behind a modal is no confirmation at all.
  const [said, setSaid] = useState(null);
  const here = gap || chosen || gaps[0] || null;

  // Everything open that is not already committed to an hour still ahead —
  // which includes anything overdue, because rescheduling those is most of
  // what anybody taps the strip for in the evening.
  const free = useMemo(() => placeable(tasks), [tasks]);
  // A list of three hundred is a list nobody reads to the end of. The order
  // puts what is owed first, so the top of it is the part worth showing, and
  // the rest is counted rather than scrolled.
  const shown = free.slice(0, MOST);
  const rest = free.length - shown.length;

  const close = () => { setGap(null); setSaid(null); onClose(); };

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

        {said ? (
          <View style={s.said} dataSet={{ plansaid: 'true' }}>
            <Text style={s.saidText} numberOfLines={2}>{said.text}</Text>
            {/* The second step, offered rather than given a button of its own.
                A week is what most things need; a month is the exception, and
                an exception costs one more tap rather than a third control on
                every row. */}
            {said.more ? (
              <TouchableOpacity
                onPress={() => setSaid(said.more.run())}
                accessibilityRole="button"
                accessibilityLabel="Put it off by a month instead"
                dataSet={{ putoffmore: 'true' }}
              >
                <Text style={s.saidUndo}>{said.more.label}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => { said.undo(); setSaid(null); }}
              accessibilityRole="button"
              accessibilityLabel="Undo that"
            >
              <Text style={[s.saidUndo, s.saidLast]}>Undo</Text>
            </TouchableOpacity>
          </View>
        ) : null}

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
                    + 'Pick something to do in it.'
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
                    <TouchableOpacity
                      style={s.rowMain}
                      onPress={() => { onPlace(task, here); setGap(null); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Do ${task.title} at ${here ? clockOf(here.start) : ''}`}
                      dataSet={{ plantask: 'true' }}
                    >
                      <Text style={s.rowText} numberOfLines={2}>{task.title}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.act}
                      onPress={() => setSaid(onPutOff(task))}
                      accessibilityRole="button"
                      accessibilityLabel={`Put ${task.title} off by a month`}
                      dataSet={{ putoff: 'true' }}
                    >
                      <Text style={s.actText}>Put off</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.act}
                      onPress={() => setSaid(onToMonth(task))}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${task.title} under Month, keeping its date`}
                      dataSet={{ tomonth: 'true' }}
                    >
                      <Text style={s.actText}>Month</Text>
                    </TouchableOpacity>
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  rowMain: { flex: 1, paddingRight: 10 },
  // The hour is the same for every row and is already in the line above, so
  // repeating it beside each one was noise where two decisions now live.
  rowText: { fontFamily: SANS, fontSize: typeSize(15), color: COLORS.ink },
  act: { paddingVertical: 6, paddingHorizontal: 9, marginLeft: 4 },
  actText: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent },
});
