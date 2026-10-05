import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { alertBody } from '../services/alerts';
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
  visible, alerts = [], whereOf, onOpen, onDone, onPutOff, onClose,
}) {
  const [said, setSaid] = useState(null);
  const close = () => { setSaid(null); onClose(); };

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

        {said ? (
          <View style={s.said} dataSet={{ duesaid: 'true' }}>
            <Text style={s.saidText} numberOfLines={2}>{said.text}</Text>
            {said.more ? (
              <TouchableOpacity
                onPress={() => setSaid(said.more.run())}
                accessibilityRole="button"
                accessibilityLabel="Put it off by a month instead"
                dataSet={{ duemore: 'true' }}
              >
                <Text style={s.saidUndo}>{said.more.label}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => { said.undo(); setSaid(null); }}
              accessibilityRole="button"
              accessibilityLabel="Undo that"
            >
              <Text style={s.saidUndo}>Undo</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={s.body}>
          {alerts.length === 0 ? (
            <Text style={s.empty}>Nothing is due.</Text>
          ) : (
            alerts.map(alert => {
              const task = alert.task;
              const where = typeof whereOf === 'function' ? whereOf(task) || '' : '';
              return (
                <View key={task.id} style={s.row} dataSet={{ duerow: 'true' }}>
                  {/* The tick first, because most of what a reminder catches
                      is already done or takes a moment. */}
                  <TouchableOpacity
                    style={s.box}
                    onPress={() => onDone(task)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`Mark ${task.title} as done`}
                    dataSet={{ duedone: 'true' }}
                  />
                  <TouchableOpacity
                    style={s.rowMain}
                    onPress={() => onOpen(task)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${task.title}`}
                    dataSet={{ dueopen: 'true' }}
                  >
                    <Text style={s.rowText} numberOfLines={2}>{task.title}</Text>
                    <Text style={s.rowWhen}>{alertBody(alert, where)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.act}
                    onPress={() => setSaid(onPutOff(task))}
                    accessibilityRole="button"
                    accessibilityLabel={`Put ${task.title} off by a week`}
                    dataSet={{ dueputoff: 'true' }}
                  >
                    <Text style={s.actText}>Put off</Text>
                  </TouchableOpacity>
                </View>
              );
            })
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

  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  box: {
    width: 19, height: 19, borderWidth: 1.4, borderColor: COLORS.check,
    borderRadius: 2, marginRight: 13,
  },
  rowMain: { flex: 1, paddingRight: 10 },
  rowText: { fontFamily: SANS, fontSize: typeSize(15), color: COLORS.ink },
  rowWhen: { fontFamily: SERIF, fontStyle: 'italic', fontSize: typeSize(12), color: COLORS.inkFaint, marginTop: 3 },
  act: { paddingVertical: 6, paddingHorizontal: 9 },
  actText: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent },

  empty: { fontFamily: SERIF, fontStyle: 'italic', fontSize: typeSize(14), color: COLORS.inkFaint, marginTop: 24 },
});
