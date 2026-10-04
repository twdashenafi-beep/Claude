import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, SANS, typeSize } from '../utils/theme';
import {
  barCaption, barDrawable, barNow, barSegments, clockOf, loadSentence,
} from '../services/agenda';

// The day, drawn.
//
// A hairline the width of the column, from the hour the day opens to the hour
// it closes, with the booked stretches inked in. No numbers on it: the clock
// times at the two ends are the ruler, and everything else is a shape you read
// at a glance — a solid morning, a hole at two, a clear run to six.
//
// It falls back to a sentence, which is the same day said in words. Not a
// degraded version: on the first render there is no measured width yet, a week
// or a month has no shape to draw, a day with a holiday in it and no meetings
// has nothing to ink, and a screen reader cannot see a line at all. All four
// get the sentence, which is why the sentence is the accessible label of the
// drawing rather than a thing written twice.

// Tall enough to read as a mark and short enough to stay furniture.
const TRACK = 4;
// The tick for now stands a little clear of the track, like the pencil ticks
// above the column headings.
const TICK = 10;

export default function DayBar({ load, now, style }) {
  const [width, setWidth] = useState(0);

  const measure = useCallback(event => {
    const found = Math.round(event.nativeEvent.layout.width);
    setWidth(previous => (previous === found ? previous : found));
  }, []);

  const sentence = loadSentence(load, now);
  const segments = barDrawable(load) ? barSegments(load, width) : [];

  // The sentence holds the place until there is a width to draw into, and
  // keeps it on anything that never reports one.
  if (segments.length === 0) {
    if (!sentence) return null;
    return (
      <View onLayout={measure} style={style}>
        <Text style={s.sentence} dataSet={{ diaryline: 'true' }}>{sentence}</Text>
      </View>
    );
  }

  const tick = barNow(load, width, now);

  return (
    <View
      onLayout={measure}
      style={[s.bar, style]}
      dataSet={{ daybar: 'true', diaryline: 'true' }}
      accessibilityRole="image"
      accessibilityLabel={sentence}
    >
      <View style={s.strip}>
        <View style={s.track}>
          {segments.map(segment => (
            <View
              key={`${segment.left}-${segment.width}`}
              style={[s.booked, { left: segment.left, width: segment.width }]}
              dataSet={{ booked: 'true' }}
            />
          ))}
        </View>
        {tick === null ? null : (
          // Carried in a sliver of the surface colour so it stays visible
          // where it crosses an inked block, which is most of the time.
          <View
            style={[s.nowCarrier, { left: clampTick(tick, width) }]}
            dataSet={{ nowtick: 'true' }}
            aria-hidden
          >
            <View style={s.now} />
          </View>
        )}
      </View>
      <View style={s.ends}>
        <Text style={s.bound}>{clockOf(load.window.from)}</Text>
        <Text style={s.caption}>{barCaption(load)}</Text>
        <Text style={[s.bound, s.boundEnd]}>{clockOf(load.window.to)}</Text>
      </View>
    </View>
  );
}

// The tick is three pixels wide and must not hang off either end of the track.
function clampTick(at, width) {
  return Math.max(0, Math.min(width - 3, at - 1.5));
}

const s = StyleSheet.create({
  bar: { marginTop: 7 },
  // The tick is taller than the track, so the row is the tick's height and
  // the track sits in the middle of it.
  strip: { height: TICK, justifyContent: 'center' },
  track: {
    height: TRACK,
    borderRadius: TRACK / 2,
    backgroundColor: COLORS.rule,
    overflow: 'hidden',
  },
  // Rounded at both ends: a meeting has a beginning and an end, and a square
  // edge against a rounded track reads as a rendering fault.
  booked: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: TRACK / 2,
    backgroundColor: COLORS.pencil,
  },
  nowCarrier: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    alignItems: 'center',
    backgroundColor: COLORS.sheet,
  },
  // Pencil, not the red pen. The red is the app's one urgency colour and now
  // is not an emergency, it is where you are standing.
  now: { width: 1, flex: 1, backgroundColor: COLORS.pencil },

  ends: { flexDirection: 'row', alignItems: 'baseline', marginTop: 3 },
  // The two bounds are the axis and the caption is the fact, so they are not
  // the same weight — which is the whole complaint about the line this
  // replaces, where three facts were separated by identical dots.
  bound: { fontFamily: SANS, fontSize: typeSize(10), color: COLORS.inkFaint, minWidth: 34 },
  boundEnd: { textAlign: 'right' },
  caption: {
    flex: 1, textAlign: 'center',
    fontFamily: SANS, fontSize: typeSize(11), color: COLORS.inkSoft,
  },
  sentence: { fontFamily: SANS, fontSize: typeSize(12), color: COLORS.inkSoft, marginTop: 3 },
});
