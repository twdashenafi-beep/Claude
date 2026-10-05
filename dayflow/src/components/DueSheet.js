import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { alertBody } from '../services/alerts';
import LaterPicker from './LaterPicker';
import TickBox from './TickBox';
import WhenSheet from './WhenSheet';
import { COLORS, SANS, SERIF, SHEET_MAX_WIDTH, typeSize } from '../utils/theme';

// Everything that is due, not the first of it.
//
// The strip said "Due now · Cleanup — Update Wondafrash, and 3 more" and
// tapping it opened the first task and cleared the rest. Not merely opened one
// of four: discarded three, which had already been marked as shown and so
// could never come back. Somebody looked up because four things were due, and
// the app dealt with one and forgot the others on their behalf.
//
// So: all of them, and the two things anybody actually does with a thing that
// has just come due. Tick it, because most of what a reminder catches is
// already done or takes a moment. Put it off, because the rest is not
// happening now and saying so is better than dismissing the reminder and
// pretending. Opening the task is still there for the one that needs thought.

export default function DueSheet({
  visible, alerts = [], whereOf, onOpen, onDone, onPutOff, onPutOffTo, onClose,
}) {
  // Held from the moment it opens, for the same reason the planner holds its
  // list: a row ticked or put off would otherwise disappear as you touched it,
  // taking with it both the undo and any sense of how far down you had got.
  const [held, setHeld] = useState([]);
  useEffect(() => {
    if (visible) setHeld(alerts);
    // Deliberately only on opening: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Which rows have been ticked in this pass.
  //
  // The box was a bordered square with no done state: tapping it completed the
  // task and drew nothing, so the one action anybody takes on a reminder
  // looked broken. Kept here rather than read back off the task, because the
  // list is held from the moment the sheet opens and a row that reported
  // itself from the live task would contradict the row it sits on.
  const [ticked, setTicked] = useState({});

  // Which row asked for a calendar, and where to report the answer back to.
  // The row's own picker holds the "→ Fri 23 Oct · Undo" state, so the sheet
  // carries its setter across rather than growing a second place that says what
  // just happened.
  const [exact, setExact] = useState(null);

  // Android's back button closes one thing at a time. With the calendar
  // open it is the calendar, not the sheet behind it and everything
  // half-decided in it.
  const close = () => {
    if (exact) { setExact(null); return; }
    setTicked({}); onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={close}>
      <View style={s.page}>
        <View style={s.head}>
          <TouchableOpacity onPress={close} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={s.close}>Done</Text>
          </TouchableOpacity>
          <Text style={s.title} accessibilityRole="header">Due</Text>
          <View style={s.balance} />
        </View>

        <ScrollView contentContainerStyle={s.body}>
          {held.length === 0 ? (
            <Text style={s.empty}>Nothing is due.</Text>
          ) : (
            held.map(alert => {
              const task = alert.task;
              const where = typeof whereOf === 'function' ? whereOf(task) || '' : '';
              return (
                <View key={task.id} style={s.row} dataSet={{ duerow: 'true' }}>
                  {/* The tick first, because most of what a reminder catches
                      is already done or takes a moment. Tapping again takes it
                      back, the same as the checkbox on the page behind this. */}
                  <TickBox
                    on={!!ticked[task.id]}
                    title={task.title}
                    tag="duedone"
                    onPress={() => {
                      onDone(task);
                      setTicked(was => ({ ...was, [task.id]: !was[task.id] }));
                    }}
                  />
                  <TouchableOpacity
                    style={s.rowMain}
                    onPress={() => onOpen(task)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${task.title}`}
                    dataSet={{ dueopen: 'true' }}
                  >
                    <Text
                      style={[s.rowText, ticked[task.id] && s.rowTextDone]}
                      numberOfLines={2}
                    >
                      {task.title}
                    </Text>
                    <Text style={s.rowWhen}>{alertBody(alert, where)}</Text>
                  </TouchableOpacity>
                  <LaterPicker
                    onPick={step => onPutOff(task, step)}
                    onExact={onPutOffTo ? report => setExact({ task, report }) : null}
                  />
                </View>
              );
            })
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

  row: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  rowMain: { flex: 1, paddingRight: 10 },
  rowText: { fontFamily: SANS, fontSize: typeSize(15), color: COLORS.ink },
  rowTextDone: { color: COLORS.done, textDecorationLine: 'line-through' },
  rowWhen: { fontFamily: SERIF, fontStyle: 'italic', fontSize: typeSize(12), color: COLORS.inkFaint, marginTop: 3 },
  act: { paddingVertical: 6, paddingHorizontal: 9 },
  actText: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent },

  empty: { fontFamily: SERIF, fontStyle: 'italic', fontSize: typeSize(14), color: COLORS.inkFaint, marginTop: 24 },
});
