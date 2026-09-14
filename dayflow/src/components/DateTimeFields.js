import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Platform, ScrollView,
} from 'react-native';
import {
  format, startOfMonth, getDay, getDaysInMonth, addMonths, subMonths,
  isSameDay, isToday as isDateToday,
} from 'date-fns';
import { COLORS } from '../utils/theme';

// Date and time, in one place.
//
// Both the add sheet and the task sheet need these, and when the task sheet
// only displayed them a task's time could be set once and never changed. Two
// copies of a calendar and a clock would drift; one cannot.

// Hide the scrollbars on the drum columns.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const id = 'drum-picker-style';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '.drum-scroll::-webkit-scrollbar { display: none; }';
    document.head.appendChild(style);
  }
}

// ── Inline Calendar ──────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_HEADERS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function InlineCalendar({ selectedDate, onSelectDate }) {
  const [viewMonth, setViewMonth] = useState(startOfMonth(selectedDate));
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const daysInMonth = getDaysInMonth(viewMonth);
  const startDay = getDay(startOfMonth(viewMonth));

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  while (rows.length > 0 && rows[rows.length - 1].length < 7) rows[rows.length - 1].push(null);

  return (
    <View style={calStyles.wrap}>
      <View style={calStyles.nav}>
        <TouchableOpacity
          onPress={() => setViewMonth(subMonths(viewMonth, 1))}
          style={calStyles.navBtn}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Text style={calStyles.arrow}>‹</Text>
        </TouchableOpacity>
        <Text style={calStyles.navTitle}>{MONTH_NAMES[month]} {year}</Text>
        <TouchableOpacity
          onPress={() => setViewMonth(addMonths(viewMonth, 1))}
          style={calStyles.navBtn}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Text style={calStyles.arrow}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={calStyles.headerRow}>
        {DAY_HEADERS.map(d => (
          <View key={d} style={calStyles.hCell}><Text style={calStyles.hText}>{d}</Text></View>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={calStyles.row}>
          {row.map((day, ci) => {
            if (day === null) return <View key={ci} style={calStyles.cell} />;
            const date = new Date(year, month, day);
            const sel = isSameDay(date, selectedDate);
            const today = isDateToday(date);
            return (
              <TouchableOpacity
                key={ci}
                style={[calStyles.cell, sel && calStyles.cellSel, !sel && today && calStyles.cellToday]}
                onPress={() => onSelectDate(date)}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={format(date, 'EEEE d MMMM yyyy')}
                aria-selected={sel}
              >
                <Text style={[calStyles.cText, sel && calStyles.cTextSel, !sel && today && calStyles.cTextToday]}>
                  {day}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const calStyles = StyleSheet.create({
  wrap: { paddingTop: 8, paddingBottom: 4, paddingHorizontal: 4 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  navBtn: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  arrow: { fontSize: 20, color: COLORS.accent, fontWeight: '400' },
  navTitle: { fontSize: 15, fontWeight: '600', color: COLORS.ink },
  headerRow: { flexDirection: 'row', marginBottom: 4 },
  hCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  hText: { fontSize: 11, fontWeight: '600', color: COLORS.inkSoft },
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, margin: 1, borderRadius: 20 },
  cellSel: { backgroundColor: COLORS.accent },
  cellToday: { borderWidth: 1.5, borderColor: COLORS.accent },
  cText: { fontSize: 15, color: COLORS.ink },
  cTextSel: { color: COLORS.sheet, fontWeight: '600' },
  cTextToday: { color: COLORS.accent, fontWeight: '600' },
});

// ── Time Picker Modal ────────────────────────────────────────────────────────

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

// A drum, as on a phone's own time picker.
//
// This was a pair of plus and minus buttons, and minutes stepped by one: going
// from the hour to half past it took thirty taps. A drum crosses the same
// distance with one flick, and lands nowhere it could not land before.
//
// Every value is also a button that scrolls to itself. That is not decoration:
// it is how a mouse picks a value, how a keyboard reaches one, and how a screen
// reader — which can do nothing with a flick — chooses at all.
const ITEM_H = 44;
const VISIBLE = 5;
const DRUM_H = ITEM_H * VISIBLE;
const PAD = (DRUM_H - ITEM_H) / 2;

function Drum({ label, values, value, format, onChange, nameOf }) {
  const ref = React.useRef(null);
  const settle = React.useRef(null);
  const index = Math.max(0, values.indexOf(value));

  // Put the drum where the value is whenever it is set from outside — opening
  // the sheet, or the hour changing under a minute that did not move.
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const id = setTimeout(() => {
      try { node.scrollTo({ y: index * ITEM_H, animated: false }); } catch { /* not laid out yet */ }
    }, 0);
    return () => clearTimeout(id);
  }, [index]);

  React.useEffect(() => () => clearTimeout(settle.current), []);

  // Read the value off the scroll position once it stops. onMomentumScrollEnd
  // is not dependable on the web, so this waits for the scrolling to go quiet
  // instead of waiting to be told it has.
  const onScroll = e => {
    const y = e.nativeEvent.contentOffset.y;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const i = Math.max(0, Math.min(values.length - 1, Math.round(y / ITEM_H)));
      if (values[i] !== value) onChange(values[i]);
    }, 110);
  };

  const pick = v => {
    onChange(v);
    const node = ref.current;
    if (node) {
      try { node.scrollTo({ y: values.indexOf(v) * ITEM_H, animated: true }); } catch { /* fine */ }
    }
  };

  return (
    <View style={tp.col}>
      <Text style={tp.colLabel}>{label}</Text>
      <View style={tp.drumWrap}>
        {/* The band the chosen value sits in, drawn behind and ignored by
            touches so it cannot get between a finger and the drum. */}
        <View style={tp.band} pointerEvents="none" />
        <ScrollView
          ref={ref}
          style={tp.drum}
          // eslint-disable-next-line react-native/no-inline-styles
          contentContainerStyle={{ paddingVertical: PAD }}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_H}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={onScroll}
          dataSet={{ drum: label.toLowerCase() }}
          className="drum-scroll"
        >
          {values.map(v => {
            const on = v === value;
            return (
              <TouchableOpacity
                key={v}
                style={tp.item}
                onPress={() => pick(v)}
                accessibilityRole="radio"
                aria-checked={on}
                accessibilityLabel={nameOf(v)}
              >
                <Text style={[tp.itemText, on && tp.itemTextOn]}>{format(v)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}


function TimePickerModal({ visible, hour24, minute, onConfirm, onCancel, onClear }) {
  const h = parseInt(hour24, 10);
  const [hour, setHour] = React.useState(h === 0 ? 12 : h > 12 ? h - 12 : h);
  const [min, setMin] = React.useState(parseInt(minute, 10));
  const [period, setPeriod] = React.useState(h >= 12 ? 'PM' : 'AM');

  React.useEffect(() => {
    if (visible) {
      const hh = parseInt(hour24, 10);
      setHour(hh === 0 ? 12 : hh > 12 ? hh - 12 : hh);
      setMin(parseInt(minute, 10));
      setPeriod(hh >= 12 ? 'PM' : 'AM');
    }
  }, [visible]);

  const handleDone = () => {
    let h24;
    if (period === 'AM') h24 = hour === 12 ? 0 : hour;
    else h24 = hour === 12 ? 12 : hour + 12;
    onConfirm(String(h24), String(min).padStart(2, '0'));
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* The backdrop is a dismiss target; the sheet inside it only swallows
          taps, so it is not a control and should not be announced as one. */}
      <TouchableOpacity
        style={tp.overlay}
        activeOpacity={1}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Close without choosing a time"
      >
        <TouchableOpacity style={tp.sheet} activeOpacity={1} onPress={() => {}} accessible={false}>
          <Text style={tp.preview} accessibilityRole="header" accessibilityLabel={
            `Chosen time ${hour}:${String(min).padStart(2, '0')} ${period}`
          }>
            {hour}:{String(min).padStart(2, '0')} {period}
          </Text>

          <View style={tp.row}>
            <Drum
              label="Hour"
              values={HOURS_12}
              value={hour}
              format={v => String(v)}
              nameOf={v => `Hour ${v}`}
              onChange={setHour}
            />

            <Text style={tp.colon}>:</Text>

            <Drum
              label="Min"
              values={MINUTES}
              value={min}
              format={v => String(v).padStart(2, '0')}
              nameOf={v => `Minute ${String(v).padStart(2, '0')}`}
              onChange={setMin}
            />

            {/* Two values are not a drum. A pair of buttons says what it is at
                a glance and needs no scrolling to reach either one. */}
            <View style={tp.col}>
              <Text style={tp.colLabel}>{' '}</Text>
              <View style={tp.ampmStack}>
                <TouchableOpacity
                  style={[tp.ampm, period === 'AM' && tp.ampmActive]}
                  onPress={() => setPeriod('AM')}
                  accessibilityRole="button"
                  accessibilityLabel="Morning"
                  aria-pressed={period === 'AM'}
                >
                  <Text style={[tp.ampmText, period === 'AM' && tp.ampmTextActive]}>AM</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[tp.ampm, period === 'PM' && tp.ampmActive]}
                  onPress={() => setPeriod('PM')}
                  accessibilityRole="button"
                  accessibilityLabel="Afternoon"
                  aria-pressed={period === 'PM'}
                >
                  <Text style={[tp.ampmText, period === 'PM' && tp.ampmTextActive]}>PM</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={tp.footer}>
            <TouchableOpacity
              style={tp.footerBtn} onPress={onCancel}
              accessibilityRole="button" accessibilityLabel="Cancel choosing a time"
            >
              <Text style={tp.cancelText}>Cancel</Text>
            </TouchableOpacity>
            {onClear ? (
              <>
                <View style={tp.footerDiv} />
                <TouchableOpacity
                  style={tp.footerBtn} onPress={onClear}
                  accessibilityRole="button" accessibilityLabel="Remove the time"
                >
                  <Text style={tp.cancelText}>Clear</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <View style={tp.footerDiv} />
            <TouchableOpacity
              style={tp.footerBtn} onPress={handleDone}
              accessibilityRole="button" accessibilityLabel="Use this time"
            >
              <Text style={tp.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const tp = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center',
  },
  sheet: {
    backgroundColor: COLORS.sheet, borderRadius: 14, width: 300, overflow: 'hidden',
  },
  preview: {
    fontSize: 32, fontWeight: '700', color: COLORS.ink, textAlign: 'center', paddingTop: 24, paddingBottom: 16,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, paddingBottom: 24, gap: 10,
  },
  col: { alignItems: 'center', gap: 6 },
  colLabel: { fontSize: 11, fontWeight: '600', color: COLORS.inkSoft, marginBottom: 2 },
  drumWrap: { height: DRUM_H, width: 72, justifyContent: 'center' },
  drum: { height: DRUM_H },
  // The chosen value sits in this band rather than being coloured, so the drum
  // reads as a dial with a window in it rather than a list with a highlight.
  band: {
    position: 'absolute', left: 0, right: 0, top: PAD, height: ITEM_H,
    backgroundColor: '#F4F1EA', borderRadius: 10,
  },
  item: { height: ITEM_H, justifyContent: 'center', alignItems: 'center' },
  itemText: { fontSize: 22, color: COLORS.inkFaint, fontVariant: ['tabular-nums'] },
  itemTextOn: { fontSize: 26, fontWeight: '700', color: COLORS.ink },
  colon: { fontSize: 30, fontWeight: '700', color: COLORS.ink },
  ampmStack: { gap: 8, justifyContent: 'center', height: DRUM_H },
  ampm: {
    width: 56, height: 46, borderRadius: 12,
    backgroundColor: '#F4F1EA', justifyContent: 'center', alignItems: 'center',
  },
  ampmActive: { backgroundColor: COLORS.accent },
  ampmText: { fontSize: 15, fontWeight: '600', color: COLORS.inkSoft },
  ampmTextActive: { color: COLORS.sheet },
  footer: {
    flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.rule,
  },
  footerBtn: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  footerDiv: { width: StyleSheet.hairlineWidth, backgroundColor: COLORS.rule },
  cancelText: { fontSize: 17, color: COLORS.inkSoft },
  doneText: { fontSize: 17, fontWeight: '600', color: COLORS.accent },
});

// ── Helper: Section Row ──────────────────────────────────────────────────────

// ── The two chips, and everything behind them ────────────────────────────────

const CHIP = StyleSheet.create({
  opts: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#F4F1EA',
  },
  chipOn: { backgroundColor: COLORS.ink },
  chipIcon: { fontSize: 13 },
  chipLabel: { fontSize: 13.5, color: COLORS.inkSoft },
  chipLabelOn: { color: COLORS.sheet, fontWeight: '600' },
});

function splitTime(dueTime) {
  const [h, m] = String(dueTime || '').split(':');
  const hour = parseInt(h, 10);
  const minute = parseInt(m, 10);
  return {
    hour24: Number.isFinite(hour) ? String(hour) : String(new Date().getHours()),
    minute: Number.isFinite(minute)
      ? String(minute).padStart(2, '0')
      : String(new Date().getMinutes()).padStart(2, '0'),
  };
}

// `value` is { dueDate: ISO string or '', dueTime: 'HH:MM' or '' }. Both empty
// means the task has neither, which is the state the chips toggle out of.
export default function DateTimeFields({ value, onChange }) {
  const dueDate = value.dueDate || '';
  const dueTime = value.dueTime || '';
  const dateEnabled = !!dueDate;
  const timeEnabled = !!dueTime;

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  const selectedDate = dueDate ? new Date(dueDate) : new Date();
  const { hour24, minute } = splitTime(dueTime);

  const dateLabel = dateEnabled
    ? (isDateToday(selectedDate) ? 'Today' : format(selectedDate, 'EEE, MMM d, yyyy'))
    : 'Date';

  const timeLabel = (() => {
    if (!timeEnabled) return 'Time';
    const h = parseInt(hour24, 10);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${minute} ${period}`;
  })();

  // The date carries the time, so setting either has to rebuild both.
  const commit = (date, time) => {
    if (!date) return onChange({ dueDate: '', dueTime: '' });
    const next = new Date(date);
    if (time) {
      const [h, m] = time.split(':').map(Number);
      next.setHours(h, m, 0, 0);
    }
    onChange({ dueDate: next.toISOString(), dueTime: time || '' });
  };

  return (
    <>
      <View style={CHIP.opts}>
        <TouchableOpacity
          style={[CHIP.chip, dateEnabled && CHIP.chipOn]}
          accessibilityRole="button"
          accessibilityLabel={dateEnabled ? `Due ${dateLabel}. Change or clear the date.` : 'Set a date'}
          onPress={() => {
            if (dateEnabled) { setCalendarOpen(false); commit(null, ''); }
            else { commit(new Date(), dueTime); setCalendarOpen(true); }
          }}
        >
          <Text style={CHIP.chipIcon}>📅</Text>
          <Text style={[CHIP.chipLabel, dateEnabled && CHIP.chipLabelOn]}>{dateLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[CHIP.chip, timeEnabled && CHIP.chipOn]}
          accessibilityRole="button"
          accessibilityLabel={timeEnabled ? `Due at ${timeLabel}. Change or clear the time.` : 'Set a time'}
          // It used to clear the time instead, so changing one meant clearing
          // it and starting from nothing — and the label had been promising
          // "change or clear" the whole time. Now it opens where the time
          // already is, and clearing is a word in the picker.
          onPress={() => setTimePickerOpen(true)}
        >
          <Text style={CHIP.chipIcon}>🕐</Text>
          <Text style={[CHIP.chipLabel, timeEnabled && CHIP.chipLabelOn]}>{timeLabel}</Text>
        </TouchableOpacity>
      </View>

      {calendarOpen && dateEnabled ? (
        <InlineCalendar
          selectedDate={selectedDate}
          onSelectDate={date => { commit(date, dueTime); setCalendarOpen(false); }}
        />
      ) : null}

      <TimePickerModal
        visible={timePickerOpen}
        hour24={hour24}
        minute={minute}
        onCancel={() => setTimePickerOpen(false)}
        onClear={timeEnabled ? () => {
          commit(selectedDate, '');
          setTimePickerOpen(false);
        } : null}
        onConfirm={(h, m) => {
          // A time with no date would never fire, so choosing one implies today.
          commit(dueDate ? selectedDate : new Date(), `${String(h).padStart(2, '0')}:${m}`);
          setTimePickerOpen(false);
        }}
      />
    </>
  );
}
