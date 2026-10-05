import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LATER } from '../services/agenda';
import { COLORS, SANS, typeSize } from '../utils/theme';

// When, then.
//
// One control where there were two, and four named answers where there was a
// week and a hidden month. "Put off" meant plus seven days; a month was a
// second tap on a line that appeared at the top of the sheet while your finger
// was on row nine. The commonest decision in any list spoke arithmetic and
// reported itself somewhere nobody was looking.
//
// Three states, in the same place on the row: closed, open, and done. Done
// stays on the row it belongs to rather than floating to the top of the sheet,
// because feedback belongs where the action was.

export default function LaterPicker({ onPick, label = 'Later' }) {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState(null);

  if (said) {
    return (
      <View style={s.after} dataSet={{ laterdone: 'true' }}>
        <Text style={s.afterText} numberOfLines={1}>
          {`\u2192 ${said.when || said.text}`}
        </Text>
        <TouchableOpacity
          onPress={() => { said.undo(); setSaid(null); }}
          accessibilityRole="button"
          accessibilityLabel="Undo that"
        >
          <Text style={s.act}>Undo</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!open) {
    return (
      <TouchableOpacity
        style={s.button}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Put it off until"
        dataSet={{ laterbutton: 'true' }}
      >
        <Text style={s.act}>{label}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={s.options} dataSet={{ lateropen: 'true' }}>
      {LATER.map(when => (
        <TouchableOpacity
          key={when.key}
          style={s.option}
          onPress={() => { setSaid(onPick(when.key)); setOpen(false); }}
          accessibilityRole="button"
          accessibilityLabel={`Put it off until ${when.label}`}
          dataSet={{ lateroption: 'true' }}
        >
          <Text style={s.optionText}>{when.label}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={s.option}
        onPress={() => setOpen(false)}
        accessibilityRole="button"
        accessibilityLabel="Never mind"
      >
        <Text style={s.never}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  button: { paddingVertical: 6, paddingHorizontal: 9 },
  act: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent },

  // Its own line, and wrapping within it. Four short words plus a way out come
  // to a little more than a phone is wide, and a row that overflows hides the
  // last answer rather than moving it — which is how the way out ended up half
  // off the screen the first time this was drawn.
  options: {
    flexBasis: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  option: {
    borderWidth: 1, borderColor: COLORS.rule, borderRadius: 3,
    paddingVertical: 6, paddingHorizontal: 9, marginLeft: 5, marginBottom: 5,
  },
  optionText: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.ink },
  never: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.inkFaint },

  after: { flexDirection: 'row', alignItems: 'center' },
  afterText: { fontFamily: SANS, fontSize: typeSize(12), color: COLORS.inkFaint, marginRight: 10 },
});
