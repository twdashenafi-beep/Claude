import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { COLORS, SANS, SERIF, SHEET_MAX_WIDTH } from '../utils/theme';

// The shape both summary pages are cut from.
//
// The day and the week ask different questions, but they answer them the same
// way: one honest line at the top, then named sections with a count each and
// the items under them. Written once here so the two cannot drift apart — the
// first version of this had them as separate files and they had already
// disagreed about the size of a heading before either shipped.
//
// No percentages, no progress bars, no encouragement. A count and the names
// under it is the whole vocabulary.

export const MAX_LISTED = 8;

export function Line({ title, note }) {
  return (
    <View style={s.line}>
      <Text style={s.lineTitle}>{title}</Text>
      {note ? <Text style={s.lineNote}>{note}</Text> : null}
    </View>
  );
}

// Said once, at the foot of a section, rather than by listing forty tasks in a
// summary nobody would then read.
export function More({ shown, total }) {
  if (total <= shown) return null;
  return <Text style={s.more}>{`and ${total - shown} more`}</Text>;
}

// The heading and its number are one thing to read, not two. Left apart, a
// screen reader announces "Late" and then, as a separate stop, "3" — and the
// number is the whole point of the heading.
export function Section({ title, count, empty, children }) {
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

// A list of tasks under a heading, which is what most of a section is.
export function TaskLines({ tasks, noteOf }) {
  return (
    <>
      {tasks.slice(0, MAX_LISTED).map(task => (
        <Line key={task.id} title={task.title} note={noteOf ? noteOf(task) : ''} />
      ))}
      <More shown={MAX_LISTED} total={tasks.length} />
    </>
  );
}

export default function PaperSheet({
  visible, onClose, title, closeLabel, headline, note, marker, children,
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {/* Marked so the browser tests can read one sheet on its own. A modal on
          the web leaves the page behind it in the document, so "the list does
          not say X" and "this page does not say X" are different questions and
          only one of them belongs to the sheet. */}
      <View style={s.container} dataSet={marker ? { [marker]: 'true' } : undefined}>
        <View style={s.header}>
          <View style={s.headerBtn} />
          <Text style={s.headerTitle}>{title}</Text>
          <TouchableOpacity
            onPress={onClose}
            style={s.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
          >
            <Text style={s.done}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyInner}>
          <Text style={s.headline} accessibilityRole="header">{headline}</Text>
          {note ? <Text style={s.note}>{note}</Text> : null}
          {children}
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
  // Tall enough to hit, without making the header taller.
  //
  // The old briefing's Done button got to 26 pixels by accident, out of the
  // line height of a 17-point font, and the rewrite dropped it to 16 and put
  // the target at 18 — under the line, and caught by the accessibility sweep
  // rather than by anybody looking at it. Padding rather than line height, so
  // it stays right whatever the type does next. Margins per side, because
  // React Native resolves marginTop over marginVertical by specificity and not
  // by source order, which has cost this codebase a day already.
  headerBtn: {
    minWidth: 60,
    paddingTop: 13,
    paddingBottom: 13,
    marginTop: -13,
    marginBottom: -13,
    justifyContent: 'center',
  },
  headerTitle: { fontFamily: SERIF, fontSize: 17, color: COLORS.ink },
  done: { fontFamily: SANS, fontSize: 16, color: COLORS.accent, textAlign: 'right' },

  body: { flex: 1 },
  bodyInner: {
    width: '100%', maxWidth: SHEET_MAX_WIDTH, alignSelf: 'center',
    backgroundColor: COLORS.sheet, paddingHorizontal: 22, paddingTop: 24,
    minHeight: '100%',
  },

  headline: { fontFamily: SERIF, fontSize: 21, color: COLORS.ink, lineHeight: 29 },
  note: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint, marginTop: 4 },

  section: { marginTop: 28 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: {
    fontFamily: SERIF, fontSize: 12.5, letterSpacing: 1.2,
    textTransform: 'uppercase', color: COLORS.inkSoft,
  },
  sectionCount: { fontFamily: SERIF, fontSize: 13, color: COLORS.inkFaint },
  rule: { height: 1, backgroundColor: COLORS.pencil, opacity: 0.55, marginTop: 6, marginBottom: 10 },

  empty: { fontFamily: SANS, fontSize: 13.5, color: COLORS.inkFaint, fontStyle: 'italic' },

  line: { marginBottom: 9 },
  lineTitle: { fontFamily: SANS, fontSize: 14.5, color: COLORS.ink, lineHeight: 20 },
  lineNote: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint, fontStyle: 'italic', marginTop: 1 },

  more: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint, fontStyle: 'italic', marginTop: 2 },
});

// Shared by the pages that group owed things under the person holding them.
export const groupStyles = StyleSheet.create({
  group: { marginBottom: 12 },
  person: { fontFamily: SANS, fontSize: 13, fontWeight: '600', color: COLORS.ink, marginBottom: 3 },
  summary: { fontFamily: SANS, fontSize: 14.5, color: COLORS.ink, lineHeight: 21 },
  // What to walk into a meeting with, listed under it.
  bring: {
    fontFamily: SANS, fontSize: 13.5, color: COLORS.inkSoft,
    marginLeft: 12, marginTop: -4, marginBottom: 7, lineHeight: 19,
  },
  brought: { color: COLORS.done, textDecorationLine: 'line-through' },
});
