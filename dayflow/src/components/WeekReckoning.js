import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { COLORS, SANS, SERIF, SHEET_MAX_WIDTH } from '../utils/theme';
import { reckon, headline, byPerson, waitedFor } from '../services/reckoning';
import { chaseLabel } from '../services/chase';
import { whenPreview } from '../services/due';
import { dueMoment } from '../services/due';

// The week, reckoned.
//
// One page, four questions, no score. What got finished, what slipped, who is
// still holding something of yours, and what next week already has in it —
// which is the last of the four and the only one you can still do anything
// about on a Friday afternoon.
//
// Nothing here is new information. Every figure was already in the app, spread
// across three screens and a column sorted the wrong way for the question. The
// work this does is putting them side by side, where a week can be read in one
// look instead of reconstructed from memory.

const MAX_LISTED = 8;

// The heading and its number are one thing to read, not two. Left apart, a
// screen reader announces "Slipped" and then, as a separate stop, "3" — and the
// number is the whole point of the heading.
function Section({ title, count, empty, children }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text
          style={s.sectionTitle}
          accessibilityRole="header"
          accessibilityLabel={`${title}: ${count}`}
        >
          {title}
        </Text>
        <Text style={s.sectionCount} aria-hidden>{count}</Text>
      </View>
      <View style={s.rule} />
      {count === 0 ? <Text style={s.empty}>{empty}</Text> : children}
    </View>
  );
}

function Line({ title, note }) {
  return (
    <View style={s.line}>
      <Text style={s.lineTitle}>{title}</Text>
      {note ? <Text style={s.lineNote}>{note}</Text> : null}
    </View>
  );
}

// Said once, at the bottom of a section, rather than by listing forty tasks in
// a summary nobody would then read.
function More({ shown, total }) {
  if (total <= shown) return null;
  return <Text style={s.more}>{`and ${total - shown} more`}</Text>;
}

export default function WeekReckoning({ visible, onClose, tasks = [], archived = [], now }) {
  // Read once per opening. A reckoning that changed under you while you read it
  // would be a live dashboard, which is the thing this is deliberately not.
  const at = useMemo(() => (now ? new Date(now) : new Date()), [visible, now]);
  // Only while it is open. Not for the work saved — there is barely any — but
  // because a summary computed on every keystroke of every task is a summary
  // that can take the whole app down with it from behind a closed door, which
  // is exactly what happened the first time this was wired up wrong.
  const sum = useMemo(
    () => (visible ? reckon(tasks, archived, at) : null),
    [visible, tasks, archived, at],
  );
  const groups = useMemo(() => (sum ? byPerson(sum.waiting) : []), [sum]);

  if (!sum) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {/* Marked so the browser tests can read this sheet on its own. A modal
          on the web leaves the page behind it in the document, so "the list
          does not say X" and "the reckoning does not say X" are different
          questions and only one of them is this page's. */}
      <View style={s.container} dataSet={{ weeksheet: 'true' }}>
        <View style={s.header}>
          <View style={s.headerBtn} />
          <Text style={s.headerTitle}>The Week</Text>
          <TouchableOpacity
            onPress={onClose}
            style={s.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Close the week"
          >
            <Text style={s.done}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyInner}>
          <Text style={s.headline} accessibilityRole="header">{headline(sum)}</Text>
          <Text style={s.since}>{`Since ${whenPreview(sum.from.toISOString(), '', at)}`}</Text>

          <Section
            title="Finished"
            count={sum.done.length}
            empty="Nothing finished this week."
          >
            {sum.done.slice(0, MAX_LISTED).map(t => (
              <Line key={t.id} title={t.title} />
            ))}
            <More shown={MAX_LISTED} total={sum.done.length} />
          </Section>

          {/* The week's real news, and the reason this page is worth opening.
              Everything else here is reassurance; this is the part that says
              something has to move. */}
          <Section
            title="Slipped"
            count={sum.slipped.length}
            empty="Nothing past its date."
          >
            {sum.slipped.slice(0, MAX_LISTED).map(t => {
              const moment = dueMoment(t);
              return (
                <Line
                  key={t.id}
                  title={t.title}
                  note={moment ? `was due ${whenPreview(moment.at.toISOString(), t.dueTime, at)}` : ''}
                />
              );
            })}
            <More shown={MAX_LISTED} total={sum.slipped.length} />
          </Section>

          {/* Gathered under the person rather than listed by task, because the
              decision this informs is about a person: one more email, or a
              phone call. */}
          <Section
            title="Waiting on"
            count={sum.waiting.length}
            empty="Nobody is holding anything of yours."
          >
            {groups.map(group => (
              <View key={group.person.toLowerCase()} style={s.group}>
                <Text style={s.person}>{group.person}</Text>
                {group.tasks.map(t => (
                  <Line
                    key={t.id}
                    title={t.title}
                    note={[waitedFor(t, at), chaseLabel(t)].filter(Boolean).join('  ·  ')}
                  />
                ))}
              </View>
            ))}
          </Section>

          <Section
            title="Next week"
            count={sum.ahead.length}
            empty="Nothing dated yet."
          >
            {sum.ahead.slice(0, MAX_LISTED).map(t => {
              const moment = dueMoment(t);
              return (
                <Line
                  key={t.id}
                  title={t.title}
                  note={moment ? whenPreview(moment.at.toISOString(), t.dueTime, at) : ''}
                />
              );
            })}
            <More shown={MAX_LISTED} total={sum.ahead.length} />
          </Section>

          <View style={{ height: 48 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.desk },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16,
    backgroundColor: COLORS.sheet,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.rule,
  },
  headerBtn: { minWidth: 60 },
  headerTitle: { fontFamily: SERIF, fontSize: 17, color: COLORS.ink },
  done: { fontFamily: SANS, fontSize: 16, color: COLORS.accent, textAlign: 'right' },

  body: { flex: 1 },
  bodyInner: {
    width: '100%', maxWidth: SHEET_MAX_WIDTH, alignSelf: 'center',
    backgroundColor: COLORS.sheet, paddingHorizontal: 22, paddingTop: 24,
    minHeight: '100%',
  },

  headline: { fontFamily: SERIF, fontSize: 21, color: COLORS.ink, lineHeight: 29 },
  since: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint, marginTop: 4 },

  section: { marginTop: 28 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: {
    fontFamily: SERIF, fontSize: 12.5, letterSpacing: 1.2,
    textTransform: 'uppercase', color: COLORS.inkSoft,
  },
  sectionCount: { fontFamily: SERIF, fontSize: 13, color: COLORS.inkFaint },
  rule: { height: 1, backgroundColor: COLORS.pencil, opacity: 0.55, marginTop: 6, marginBottom: 10 },

  empty: { fontFamily: SANS, fontSize: 13.5, color: COLORS.inkFaint, fontStyle: 'italic' },

  group: { marginBottom: 12 },
  person: { fontFamily: SANS, fontSize: 13, fontWeight: '600', color: COLORS.ink, marginBottom: 3 },

  line: { marginBottom: 9 },
  lineTitle: { fontFamily: SANS, fontSize: 14.5, color: COLORS.ink, lineHeight: 20 },
  lineNote: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint, fontStyle: 'italic', marginTop: 1 },

  more: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint, fontStyle: 'italic', marginTop: 2 },
});
