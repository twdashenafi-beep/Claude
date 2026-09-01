import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { VIEW_MODES } from '../utils/constants';
import { COLORS, SANS } from '../utils/theme';

const VIEWS = [
  { key: VIEW_MODES.DAY, label: 'Day' },
  { key: VIEW_MODES.WEEK, label: 'Week' },
  { key: VIEW_MODES.MONTH, label: 'Month' },
];

// Plain text scopes rather than a segmented control — on the sheet this reads
// as a line of document furniture, not an app widget.
export default function ViewToggle({ activeView, onChangeView }) {
  return (
    <View style={s.row}>
      {VIEWS.map((v, i) => {
        const on = activeView === v.key;
        return (
          <React.Fragment key={v.key}>
            {i > 0 ? <Text style={s.sep}>·</Text> : null}
            <TouchableOpacity
              onPress={() => onChangeView(v.key)}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            >
              <Text style={[s.label, on && s.labelOn]}>{v.label}</Text>
            </TouchableOpacity>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12 },
  label: {
    fontFamily: SANS, fontSize: 11.5, letterSpacing: 1.2,
    textTransform: 'uppercase', color: COLORS.inkFaint,
  },
  labelOn: {
    color: COLORS.ink, fontWeight: '700',
    borderBottomWidth: 1.5, borderBottomColor: COLORS.accent, paddingBottom: 2,
  },
  sep: { color: '#D8D2C4', fontSize: 11 },
});
