import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { COLORS, SERIF, SANS, typeSize } from '../utils/theme';

// What is on screen while the vault is being decrypted.
//
// Before this there was nothing here — the day view drew itself with an empty
// list and then froze, because decrypting holds the same thread that draws. For
// several seconds the app showed a day with no tasks in it, which is precisely
// what it would show if everything had been lost. The wait was survivable; the
// impression was not.
//
// So: the count, and a line that fills. Both are the truth rather than an
// animation pretending to be one — the bar is at the row the decrypt has
// actually reached, and it slows down at the end because that is where the
// recordings are.
export default function Opening({ done = 0, total = 0 }) {
  const through = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <SafeAreaView style={s.desk}>
      <View style={s.middle}>
        <Text style={s.word}>Opening your vault</Text>
        <View style={s.track}>
          <View style={[s.fill, { width: `${Math.round(through * 100)}%` }]} />
        </View>
        <Text
          style={s.count}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Opening your vault, ${done} of ${total}`}
        >
          {total ? `${done} of ${total}` : ' '}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  desk: { flex: 1, backgroundColor: COLORS.desk },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  word: { fontFamily: SERIF, fontSize: typeSize(24), color: COLORS.ink, marginBottom: 20 },
  track: {
    width: '100%', maxWidth: 260, height: 2,
    backgroundColor: COLORS.rule, overflow: 'hidden',
  },
  fill: { height: 2, backgroundColor: COLORS.accent },
  count: { fontFamily: SANS, fontSize: typeSize(13), color: COLORS.inkFaint, marginTop: 12 },
});
