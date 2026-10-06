import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, SANS, typeSize } from '../utils/theme';
import {
  barCaption, barDrawable, barNow, barPlans, barSegments, clockOf, gapAt, loadSentence,
  bookedAt, bookedLine,
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

export default function DayBar({ load, now, plans = [], onPickGap, style }) {
  const [width, setWidth] = useState(0);
  // Which meeting was asked about, if one was. Held here rather than passed in:
  // it is a question about the drawing, answered on the drawing, and it lasts
  // until the next tap or the next time the day underneath changes.
  const [named, setNamed] = useState(null);
  // Cleared when the day underneath actually changes, not when `load` is rebuilt
  // — it is remade whenever the task list is, which is often, and keying this to
  // the object itself wiped the answer within a frame of giving it.
  const shape = load
    ? `${+load.window.from}-${+load.window.to}-${load.committed}-${load.events.length}`
    : '';
  useEffect(() => { setNamed(null); }, [shape]);

  const measure = useCallback(event => {
    const found = Math.round(event.nativeEvent.layout.width);
    setWidth(previous => (previous === found ? previous : found));
  }, []);

  const sentence = loadSentence(load, now);
  const segments = barDrawable(load) ? barSegments(load, width) : [];
  // Drawn for plans as well as meetings. A day with one thing you have decided
  // to do and nothing anybody else has booked still has a shape, and it is the
  // shape you made.
  const planned = barPlans(load, plans, width);

  // Which gap a finger landed on. Forgiving: a gap is twenty pixels wide on a
  // phone and a finger is wider, so a tap that misses falls forward to the
  // next free time, which is almost always what was meant.
  const tapped = event => {
    if (!onPickGap) return;
    const native = (event && event.nativeEvent) || {};

    // Where along the day the finger landed.
    //
    // locationX is what a phone reports and it is what this read. On the web a
    // press event does not carry one at all, so this was undefined on every tap
    // — and the forgiving fall-forward below turned that into a plausible
    // answer every time, which is why nothing ever looked wrong. Tapping a
    // meeting could not have worked, because the tap never knew where it was.
    let x = Number(native.locationX);
    if (!Number.isFinite(x)) {
      const node = event && event.currentTarget;
      const rect = node && typeof node.getBoundingClientRect === 'function'
        ? node.getBoundingClientRect()
        : null;
      const page = Number(native.pageX);
      if (rect && Number.isFinite(page)) x = page - rect.left;
    }
    // Still unknown: fall forward from the start of the day, which is what this
    // did by accident before and is the kinder of the two wrong answers.
    if (!Number.isFinite(x)) x = 0;
    // Answered even when the answer is none. Past the end of a working day
    // there is no free time left to tap, and this used to do nothing at all —
    // a dead control that looks exactly like a broken one, which is the fault
    // this app has spent two days taking out of everything else.
    // A tap on a meeting asks what it is; a tap anywhere else asks for the
    // free time. The strip said how much and when and never what, and the
    // names were two taps away in the briefing — while a tap on a meeting
    // fell forward to the next free stretch and opened the planner for an
    // hour nobody had pointed at.
    const hit = bookedAt(load, width, x);
    if (hit) { setNamed(hit); return; }
    setNamed(null);
    onPickGap(gapAt(load, width, x));
  };

  // The sentence holds the place until there is a width to draw into, and
  // keeps it on anything that never reports one.
  if (segments.length === 0 && planned.length === 0) {
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
      <Pressable
        onPress={tapped}
        disabled={!onPickGap}
        // The hit area is the row, not the four-pixel line in the middle of it.
        hitSlop={{ top: 8, bottom: 8 }}
        accessibilityRole={onPickGap ? 'button' : undefined}
        // It does two things now, so it says both. A screen reader cannot
        // aim at a block, which is why the caption is read out as well.
        accessibilityLabel={onPickGap
          ? 'The day, drawn. Tap a meeting to hear what it is, or free time to put a task in it'
          : undefined}
        dataSet={{ striptap: 'true' }}
        style={s.strip}
      >
        {/* Nothing drawn inside the strip takes a touch.
            locationX is measured from whatever the finger landed on, so a tap
            on a meeting arrived as a few pixels into that block rather than as
            a position along the day — which read as an hour near the start of
            the morning, found nothing booked there, and opened the planner for
            a time nobody had pointed at. With the drawing out of the way the
            Pressable is always the target and x is always along the day. */}
        <View style={s.track} pointerEvents="none">
          {segments.map(segment => (
            <View
              key={`${segment.left}-${segment.width}`}
              style={[s.booked, { left: segment.left, width: segment.width }]}
              dataSet={{ booked: 'true' }}
              pointerEvents="none"
            />
          ))}
        </View>
        {/* Lighter than a meeting, because a plan and an appointment are not
            the same promise: one is where you have to be, the other is where
            you told yourself you would be. Drawn under the now tick and over
            the track, in the same ink family a step up. */}
        {planned.map(seg => (
          <View
            key={`plan-${seg.left}-${seg.width}`}
            style={[s.planned, { left: seg.left, width: seg.width }]}
            dataSet={{ planned: 'true' }}
            pointerEvents="none"
          />
        ))}
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
      </Pressable>
      <View style={s.ends}>
        <Text style={s.bound}>{clockOf(load.window.from)}</Text>
        {/* The caption answers whatever was last asked of the strip: what
            that block is, or failing that how much of the day is spoken for.
            One line either way, because the strip is context for the list
            under it and not a panel to look at on its own. */}
        <Text style={s.caption} dataSet={{ barcaption: 'true' }} numberOfLines={1}>
          {(named && bookedLine(named))
            || barCaption(load)
            || (planned.length ? 'nothing booked' : '')}
        </Text>
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
  // A plan sits on the track like a meeting does, a step lighter. Same height,
  // because it takes the same hour out of the day whatever it is called.
  planned: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: TRACK / 2,
    backgroundColor: COLORS.inkFaint,
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
