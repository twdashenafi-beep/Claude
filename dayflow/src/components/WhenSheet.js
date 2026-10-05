import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { InlineCalendar, TimePickerModal, splitTime } from './DateTimeFields';
import { whenPreview } from '../services/due';
import { COLORS, SANS, SERIF, SHEET_MAX_WIDTH, typeSize } from '../utils/theme';

// The exact day, when a direction will not do.
//
// Tomorrow, the weekend, next week, next month: four names, one tap each, and
// between them they answer most of what anybody means by "not now". What they
// cannot answer is "the twenty-third". A payroll run is owed on a date; a
// contract starts on one; an invoice is due on one. Reckoning forwards in weeks
// to land on a date you already know is arithmetic the app should not be asking
// anybody to do.
//
// So this sits behind a fifth option rather than replacing the four. The cheap
// answer stays cheap — one tap, no sheet — and the exact answer costs a sheet,
// which is the right way round: the exact answer is the rarer one, and it is
// the one worth being careful about.
//
// The calendar and the clock are the app's own, imported rather than redrawn.
// The time is optional on purpose: a date alone means "that day", which is how
// most dated things are owed, and an hour is what you add when something has to
// happen at one.

export default function WhenSheet({ visible, task, onSet, onClose }) {
  // Opened on the day the task already has, so a date being corrected starts
  // where it is rather than at today and makes you find it again.
  const [day, setDay] = useState(null);
  const [time, setTime] = useState('');
  const [clockOpen, setClockOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const had = task && task.dueDate ? new Date(task.dueDate) : null;
    setDay(had && !Number.isNaN(+had) ? had : new Date());
    setTime(task && task.dueTime ? task.dueTime : '');
    setClockOpen(false);
    // Deliberately only on opening: a date being chosen should not jump under
    // the finger because the task behind the sheet changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const { hour24, minute } = splitTime(time);
  const chosen = day || new Date();
  // Said in the app's own voice — "Fri 23 Oct", "Tomorrow 09:00" — because this
  // is the one place somebody is deliberately being precise about a date, and a
  // slashy 23/10 is ambiguous across an ocean. whenPreview, not a second
  // formatter: this has to read the same as the line the row will show once the
  // date is set, or Set looks like it did something other than what it said.
  const said = whenPreview(chosen.toISOString(), time) || '';

  // The hour on its own, for the chip. whenPreview's string is the whole
  // sentence and pulling the clock back out of it would break the first time
  // its wording changed.
  const clockSaid = (() => {
    if (!time) return '';
    const h = parseInt(hour24, 10);
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${minute} ${h >= 12 ? 'PM' : 'AM'}`;
  })();

  return (
    // An overlay over the sheet that raised it, not a Modal of its own. The
    // clock below is a Modal, and that already sits inside one — iOS stacks two
    // reliably and this app has shipped two for months. Three is a stack nobody
    // here has tested on a phone, and the way to not find out the hard way is
    // to not build it: this covers its parent's page, which is all a Modal would
    // have done anyway.
    <View style={s.page}>
      <View style={s.head}>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close without choosing a date">
          <Text style={s.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title} accessibilityRole="header">Until</Text>
        <TouchableOpacity
          onPress={() => { onSet(chosen, time); onClose(); }}
          accessibilityRole="button"
          accessibilityLabel={`Put it off until ${said}`}
          dataSet={{ whenset: 'true' }}
        >
          <Text style={s.set}>Set</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {task ? <Text style={s.what} numberOfLines={2}>{task.title}</Text> : null}
        {/* What Set will do, in words, where you can read it before you tap
            it. The sheet closes on Set, so this is the only chance to check
            the day you landed on is the day you meant. */}
        <Text style={s.said} dataSet={{ whensaid: 'true' }}>{said}</Text>

        <InlineCalendar selectedDate={chosen} onSelectDate={setDay} />

        <View style={s.clockRow}>
          <TouchableOpacity
            style={[s.chip, !!time && s.chipOn]}
            onPress={() => setClockOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={time ? `Due at ${clockSaid}. Change or remove the time.` : 'Add a time'}
            dataSet={{ whentime: 'true' }}
          >
            <Text style={[s.chipText, !!time && s.chipTextOn]}>
              {time ? clockSaid : 'Add a time'}
            </Text>
          </TouchableOpacity>
          <Text style={s.hint}>
            {time ? 'It will remind you then.' : 'A day with no hour just sits on that day.'}
          </Text>
        </View>
      </ScrollView>
      <TimePickerModal
        visible={clockOpen}
        hour24={hour24}
        minute={minute}
        onCancel={() => setClockOpen(false)}
        onClear={time ? () => { setTime(''); setClockOpen(false); } : null}
        onConfirm={(h, m) => { setTime(`${String(h).padStart(2, '0')}:${m}`); setClockOpen(false); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  // Covers the sheet underneath it completely, so it reads as a page rather
  // than something floating over a list.
  page: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.sheet, zIndex: 20 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 54, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  cancel: { fontFamily: SANS, fontSize: typeSize(15.5), color: COLORS.inkSoft },
  title: { fontFamily: SERIF, fontSize: typeSize(18), color: COLORS.ink },
  set: { fontFamily: SANS, fontSize: typeSize(15.5), color: COLORS.accent, fontWeight: '600' },

  body: { paddingHorizontal: 20, paddingTop: 18, maxWidth: SHEET_MAX_WIDTH, width: '100%', alignSelf: 'center' },
  what: { fontFamily: SANS, fontSize: typeSize(15), color: COLORS.ink },
  said: { fontFamily: SERIF, fontSize: typeSize(13.5), color: COLORS.inkSoft, marginTop: 6, marginBottom: 6 },

  clockRow: { marginTop: 14 },
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1, borderColor: COLORS.rule, borderRadius: 3,
    paddingVertical: 7, paddingHorizontal: 11,
  },
  chipOn: { borderColor: COLORS.pencil, backgroundColor: COLORS.pencil },
  chipText: { fontFamily: SANS, fontSize: typeSize(13), color: COLORS.inkSoft },
  chipTextOn: { color: COLORS.sheet },
  hint: { fontFamily: SANS, fontSize: typeSize(12), color: COLORS.inkFaint, marginTop: 8 },
});
