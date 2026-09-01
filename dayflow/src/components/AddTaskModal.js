import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Platform, Switch,
} from 'react-native';

// Inject CSS to hide scrollbars on drum columns
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const id = 'drum-picker-style';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '.drum-scroll::-webkit-scrollbar { display: none; }';
    document.head.appendChild(style);
  }
}

import { PRIORITY, PRIORITY_COLORS } from '../utils/constants';
import VoiceRecorder from './VoiceRecorder';
import { COLORS, SERIF } from '../utils/theme';
import {
  format, startOfMonth, getDay, getDaysInMonth, addMonths, subMonths,
  isSameDay, isToday as isDateToday,
} from 'date-fns';

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
        <TouchableOpacity onPress={() => setViewMonth(subMonths(viewMonth, 1))} style={calStyles.navBtn}>
          <Text style={calStyles.arrow}>‹</Text>
        </TouchableOpacity>
        <Text style={calStyles.navTitle}>{MONTH_NAMES[month]} {year}</Text>
        <TouchableOpacity onPress={() => setViewMonth(addMonths(viewMonth, 1))} style={calStyles.navBtn}>
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

function TimePickerModal({ visible, hour24, minute, onConfirm, onCancel }) {
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

  const incHour = () => {
    const idx = HOURS_12.indexOf(hour);
    setHour(HOURS_12[(idx + 1) % 12]);
  };
  const decHour = () => {
    const idx = HOURS_12.indexOf(hour);
    setHour(HOURS_12[(idx - 1 + 12) % 12]);
  };
  const incMin = () => setMin((min + 1) % 60);
  const decMin = () => setMin((min - 1 + 60) % 60);

  const handleDone = () => {
    let h24;
    if (period === 'AM') h24 = hour === 12 ? 0 : hour;
    else h24 = hour === 12 ? 12 : hour + 12;
    onConfirm(String(h24), String(min).padStart(2, '0'));
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity style={tp.overlay} activeOpacity={1} onPress={onCancel}>
        <TouchableOpacity style={tp.sheet} activeOpacity={1} onPress={() => {}}>
          <Text style={tp.preview}>
            {hour}:{String(min).padStart(2, '0')} {period}
          </Text>

          <View style={tp.row}>
            <View style={tp.col}>
              <Text style={tp.colLabel}>Hour</Text>
              <TouchableOpacity style={tp.btn} onPress={incHour}><Text style={tp.btnText}>+</Text></TouchableOpacity>
              <View style={tp.valBox}><Text style={tp.val}>{hour}</Text></View>
              <TouchableOpacity style={tp.btn} onPress={decHour}><Text style={tp.btnText}>−</Text></TouchableOpacity>
            </View>

            <Text style={tp.colon}>:</Text>

            <View style={tp.col}>
              <Text style={tp.colLabel}>Min</Text>
              <TouchableOpacity style={tp.btn} onPress={incMin}><Text style={tp.btnText}>+</Text></TouchableOpacity>
              <View style={tp.valBox}><Text style={tp.val}>{String(min).padStart(2, '0')}</Text></View>
              <TouchableOpacity style={tp.btn} onPress={decMin}><Text style={tp.btnText}>−</Text></TouchableOpacity>
            </View>

            <View style={tp.col}>
              <Text style={tp.colLabel}>{' '}</Text>
              <TouchableOpacity
                style={[tp.ampm, period === 'AM' && tp.ampmActive]}
                onPress={() => setPeriod('AM')}
              >
                <Text style={[tp.ampmText, period === 'AM' && tp.ampmTextActive]}>AM</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[tp.ampm, period === 'PM' && tp.ampmActive]}
                onPress={() => setPeriod('PM')}
              >
                <Text style={[tp.ampmText, period === 'PM' && tp.ampmTextActive]}>PM</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={tp.footer}>
            <TouchableOpacity style={tp.footerBtn} onPress={onCancel}>
              <Text style={tp.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <View style={tp.footerDiv} />
            <TouchableOpacity style={tp.footerBtn} onPress={handleDone}>
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
  btn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#F4F1EA', justifyContent: 'center', alignItems: 'center',
  },
  btnText: { fontSize: 26, color: COLORS.accent, fontWeight: '300', marginTop: -2 },
  valBox: {
    width: 68, height: 52, borderRadius: 12,
    backgroundColor: '#F4F1EA', justifyContent: 'center', alignItems: 'center',
  },
  val: { fontSize: 32, fontWeight: '700', color: COLORS.ink },
  colon: { fontSize: 32, fontWeight: '700', color: COLORS.ink, marginTop: 18 },
  ampm: {
    width: 52, height: 52, borderRadius: 12,
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

function SectionRow({ icon, label, value, onPress, isFirst, isLast, children, rightElement }) {
  return (
    <TouchableOpacity
      style={[
        rs.row,
        isFirst && rs.first,
        isLast && rs.last,
        !isLast && rs.border,
      ]}
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      disabled={!onPress}
    >
      {icon && <View style={rs.iconWrap}><Text style={rs.icon}>{icon}</Text></View>}
      <Text style={rs.label}>{label}</Text>
      <View style={rs.right}>
        {children}
        {rightElement}
        {value !== undefined && !children && !rightElement && (
          <>
            <Text style={rs.value}>{value}</Text>
            <Text style={rs.chevron}>›</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

function ToggleRow({ icon, iconBg, label, value, enabled, onToggle, isFirst, isLast, detail }) {
  return (
    <View style={[rs.row, isFirst && rs.first, isLast && rs.last, !isLast && rs.border]}>
      {icon && (
        <View style={[rs.iconBox, iconBg && { backgroundColor: iconBg }]}>
          <Text style={rs.iconBoxText}>{icon}</Text>
        </View>
      )}
      <View style={rs.toggleInfo}>
        <Text style={rs.label}>{label}</Text>
        {enabled && detail ? <Text style={rs.detail}>{detail}</Text> : null}
      </View>
      <Switch
        value={enabled}
        onValueChange={onToggle}
        trackColor={{ false: COLORS.rule, true: COLORS.ink }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const rs = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 16,
    backgroundColor: COLORS.sheet, minHeight: 44,
  },
  first: { borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  last: { borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule },
  iconWrap: { width: 28, marginRight: 10 },
  icon: { fontSize: 17 },
  iconBox: {
    width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  iconBoxText: { fontSize: 15, color: COLORS.sheet },
  label: { fontSize: 16, color: COLORS.ink },
  toggleInfo: { flex: 1 },
  detail: { fontSize: 13, color: COLORS.inkSoft, marginTop: 1 },
  right: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  value: { fontSize: 16, color: COLORS.inkSoft },
  chevron: { fontSize: 20, color: COLORS.inkFaint, marginLeft: 2, fontWeight: '300' },
});

// ── Priority Picker Popup ────────────────────────────────────────────────────

const PRIORITY_OPTIONS = [
  { key: 'none', label: 'None', color: COLORS.inkSoft },
  { key: 'low', label: 'Low', color: PRIORITY_COLORS.low },
  { key: 'medium', label: 'Medium', color: PRIORITY_COLORS.medium },
  { key: 'high', label: 'High', color: PRIORITY_COLORS.high },
];


// ── Main Component ───────────────────────────────────────────────────────────

export default function AddTaskModal({ visible, onClose, onAdd, section = 'todo', defaultTaskType = 'todo', viewMode, selectedDate: viewDate }) {
  // Core fields
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [voiceNoteUri, setVoiceNoteUri] = useState(null);


  // Date & Time
  const [dateEnabled, setDateEnabled] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timeEnabled, setTimeEnabled] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const now = new Date();
  const [hour24, setHour24] = useState(() => String(now.getHours()));
  const [minute, setMinute] = useState(() => String(now.getMinutes()).padStart(2, '0'));
  // Organisation
  const taskType = defaultTaskType;
  const [priority, setPriority] = useState('none');

  // Owe Me fields
  const [owePerson, setOwePerson] = useState('');

  // Formatting helpers
  const displayTime = (() => {
    const h = parseInt(hour24, 10);
    const p = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${minute} ${p}`;
  })();

  const todayLabel = (() => {
    if (isDateToday(selectedDate)) return 'Today';
    return format(selectedDate, 'EEE, MMM d, yyyy');
  })();

  // Submit
  const handleAdd = () => {
    if (!title.trim()) return;

    let dateISO = null;
    let timeStr = null;
    if (dateEnabled) {
      const combined = new Date(selectedDate);
      if (timeEnabled) {
        const h24 = parseInt(hour24, 10);
        const min = parseInt(minute, 10);
        combined.setHours(h24, min, 0, 0);
        timeStr = `${String(h24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      }
      dateISO = combined.toISOString();
    }

    const mappedPriority = priority === 'none' ? 'medium' : priority;
    const fallbackDate = (viewDate || new Date()).toISOString();

    onAdd({
      title: title.trim(),
      priority: mappedPriority,
      section,
      taskType,
      viewScope: viewMode || 'day',
      date: dateISO || fallbackDate,
      dueDate: dateISO || fallbackDate,
      dueTime: timeStr,
      reminderEnabled: !!(dateEnabled && timeEnabled),
      earlyReminderMinutes: 0,
      reminderDate: dateISO,
      reminderTime: timeStr,
      owePerson: owePerson.trim(),
      oweDescription: '',
      notes: notes.trim(),
      voiceNoteUri,
      attachments: [],
    });

    // Reset
    setTitle(''); setNotes(''); setVoiceNoteUri(null);
    setDateEnabled(false); setSelectedDate(new Date()); setCalendarOpen(false);
    setTimeEnabled(false); setTimePickerOpen(false);
    const resetNow = new Date();
    setHour24(String(resetNow.getHours()));
    setMinute(String(resetNow.getMinutes()).padStart(2, '0'));
    setPriority('none');
    setOwePerson('');
    onClose();
  };

  const isHighPriority = priority === 'high';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose}><Text style={s.cancel}>Cancel</Text></TouchableOpacity>
          <Text style={s.headerTitle}>New Task</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Title */}
          <TextInput
            style={s.titleInput}
            placeholder="What needs to be done?"
            placeholderTextColor="#C7C7CC"
            value={title}
            onChangeText={setTitle}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleAdd}
            blurOnSubmit={false}
          />

          {/* Notes */}
          <TextInput
            style={s.notesInput}
            placeholder="Notes"
            placeholderTextColor="#D1D1D6"
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          {/* Voice note */}
          <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
            <VoiceRecorder
              existingUri={voiceNoteUri}
              onRecordingComplete={(uri) => setVoiceNoteUri(uri)}
              onDelete={() => setVoiceNoteUri(null)}
            />
          </View>

          {/* Inline options */}
          <View style={s.opts}>
            {/* Date */}
            <TouchableOpacity
              style={[s.chip, dateEnabled && s.chipOn]}
              onPress={() => {
                if (dateEnabled) { setDateEnabled(false); setCalendarOpen(false); setTimeEnabled(false); }
                else { setDateEnabled(true); setCalendarOpen(true); }
              }}
            >
              <Text style={s.chipIcon}>📅</Text>
              <Text style={[s.chipLabel, dateEnabled && s.chipLabelOn]}>
                {dateEnabled ? todayLabel : 'Date'}
              </Text>
            </TouchableOpacity>

            {/* Time */}
            <TouchableOpacity
              style={[s.chip, timeEnabled && s.chipOn]}
              onPress={() => {
                if (timeEnabled) { setTimeEnabled(false); }
                else { setTimeEnabled(true); setTimePickerOpen(true); if (!dateEnabled) setDateEnabled(true); }
              }}
            >
              <Text style={s.chipIcon}>🕐</Text>
              <Text style={[s.chipLabel, timeEnabled && s.chipLabelOn]}>
                {timeEnabled ? displayTime : 'Time'}
              </Text>
            </TouchableOpacity>

            {/* Priority toggle — just high or none */}
            <TouchableOpacity
              style={[s.chip, isHighPriority && s.chipHigh]}
              onPress={() => setPriority(isHighPriority ? 'none' : 'high')}
            >
              <Text style={[s.chipIcon, isHighPriority && { color: COLORS.accent }]}>!</Text>
              <Text style={[s.chipLabel, isHighPriority && { color: COLORS.accent, fontWeight: '600' }]}>
                {isHighPriority ? 'High' : 'Priority'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Calendar inline */}
          {dateEnabled && calendarOpen && (
            <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
              <InlineCalendar
                selectedDate={selectedDate}
                onSelectDate={(date) => { setSelectedDate(date); setCalendarOpen(false); }}
              />
            </View>
          )}

          {/* Owe Me fields */}
          {taskType === 'done_for_me' && (
            <View style={s.oweSection}>
              <TextInput
                style={s.oweInput}
                placeholder="Who owes you this?"
                placeholderTextColor="#C7C7CC"
                value={owePerson}
                onChangeText={setOwePerson}
              />
              <Text style={s.oweHint}>
                Who you are waiting on. Add a date to remind yourself to chase it.
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

      <TimePickerModal
        visible={timePickerOpen}
        hour24={hour24}
        minute={minute}
        onConfirm={(h, m) => { setHour24(h); setMinute(m); setTimePickerOpen(false); }}
        onCancel={() => setTimePickerOpen(false)}
      />
    </Modal>
  );
}

// ── Picker row styles ────────────────────────────────────────────────────────

const pickS = StyleSheet.create({
  opt: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 54,
  },
  optSel: {
    backgroundColor: '#F4F1EA',
  },
  optText: { flex: 1, fontSize: 16, color: COLORS.ink },
  optTextSel: { fontWeight: '600', color: COLORS.accent },
  check: { fontSize: 16, color: COLORS.accent, fontWeight: '600' },
});

// ── Main styles ──────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.sheet },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F4F1EA',
  },
  cancel: { fontSize: 17, color: COLORS.accent },
  headerTitle: { fontFamily: SERIF, fontSize: 17, fontWeight: '600', color: COLORS.ink },
  scroll: { flex: 1 },
  titleInput: {
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8,
    fontFamily: SERIF, fontSize: 23, fontWeight: '600', color: COLORS.ink, letterSpacing: -0.3,
  },
  notesInput: {
    paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16,
    fontSize: 16, color: COLORS.inkSoft, minHeight: 44,
  },
  opts: {
    flexDirection: 'row', paddingHorizontal: 20, gap: 8, paddingBottom: 12, flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#F4F1EA', borderRadius: 20,
  },
  chipOn: { backgroundColor: '#F4F1EA' },
  chipHigh: { backgroundColor: '#F6EBE8' },
  chipIcon: { fontSize: 13 },
  chipLabel: { fontSize: 14, color: COLORS.inkSoft },
  chipLabelOn: { color: COLORS.accent, fontWeight: '500' },
  oweSection: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },
  oweHint: { fontFamily: SERIF, fontSize: 13, fontStyle: 'italic', color: COLORS.inkFaint, lineHeight: 18 },
  oweInput: {
    fontSize: 15, color: COLORS.ink, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.rule, paddingBottom: 10,
  },
});
