import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, typeSize } from '../utils/theme';

// The box you tick.
//
// It was drawn inline in the Due sheet, where for a while it had no done state
// at all: tapping it completed the task and changed nothing on screen, so the
// one action anybody takes on a reminder looked broken. The planner then needed
// the same control — most of what a triage pass turns up is already done or
// takes a moment, and having to open a task to say so is the long way round.
//
// So: one of it. A second copy would be a second chance to forget the done
// state, and that is the bug this control has already had once.

export default function TickBox({ on, title, onPress, tag = 'tick' }) {
  return (
    // The box you can see is nineteen pixels; the box you can hit is not.
    <TouchableOpacity
      style={s.hit}
      onPress={onPress}
      accessibilityRole="checkbox"
      aria-checked={!!on}
      accessibilityLabel={on ? `Mark ${title} as not done` : `Mark ${title} as done`}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 6 }}
      dataSet={{ [tag]: 'true' }}
    >
      <View style={[s.box, on && s.boxDone]}>
        {on ? <Text style={s.tick}>✓</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  hit: { paddingVertical: 6, paddingRight: 13, paddingLeft: 2 },
  box: {
    width: 19, height: 19, borderWidth: 1.4, borderColor: COLORS.check,
    borderRadius: 2, alignItems: 'center', justifyContent: 'center',
  },
  boxDone: { backgroundColor: COLORS.check, borderColor: COLORS.check },
  tick: { fontSize: typeSize(10), color: COLORS.sheet, fontWeight: '700', marginTop: -1 },
});
