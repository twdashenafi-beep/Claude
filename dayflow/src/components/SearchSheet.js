import React, { useMemo, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { searchTasks, excerpt, normalizeQuery, locationOf } from '../services/search';
import { projectName } from '../services/projects';
import { COLORS, SANS, SERIF } from '../utils/theme';

// Finding a task without remembering where you put it.
//
// The app has grown three scopes, two columns, any number of projects and an
// archive that only gets longer. Search is what stops that from being a filing
// problem: it looks everywhere at once, and every result says where it lives,
// so the answer is both "here it is" and "here is where you left it".
export default function SearchSheet({ query, onQuery, tasks, projects, onOpen, onClose }) {
  const input = useRef(null);

  // The field is the whole point of the sheet, so it takes the keyboard
  // without a second tap.
  useEffect(() => {
    const handle = setTimeout(() => input.current && input.current.focus(), 0);
    return () => clearTimeout(handle);
  }, []);

  const hits = useMemo(() => searchTasks(tasks, query), [tasks, query]);
  const folded = normalizeQuery(query);

  return (
    <View style={s.wrap}>
      <View style={s.field}>
        <TextInput
          ref={input}
          style={s.input}
          value={query}
          onChangeText={onQuery}
          placeholder="Search tasks and notes"
          placeholderTextColor={COLORS.inkFaint}
          accessibilityLabel="Search tasks and notes"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity
            onPress={() => onQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.action}>CLEAR</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close search"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.action}>DONE</Text>
        </TouchableOpacity>
      </View>
      <View style={s.rule} />

      {/* Three states, each said plainly: nothing typed yet, nothing found,
          and a count — so an empty page is never ambiguous. */}
      {folded.length < 2 ? (
        <Text style={s.note}>
          Type at least two letters. Titles, notes and the person on an Owe Me
          are searched, across every project, every view, and the archive.
        </Text>
      ) : hits.length === 0 ? (
        <Text style={s.note}>Nothing matches “{query.trim()}”.</Text>
      ) : (
        <>
          <Text style={s.count}>
            {hits.total > hits.length
              ? `${hits.length} of ${hits.total} results — type more to narrow it`
              : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`}
          </Text>

          {hits.map(hit => (
            <TouchableOpacity
              key={hit.task.id}
              style={s.row}
              onPress={() => onOpen(hit.task)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${hit.task.title}`}
            >
              <Text
                style={[s.title, hit.task.completed ? s.struck : null]}
                numberOfLines={2}
              >
                {hit.task.title}
              </Text>
              <Text style={s.where}>
                {locationOf(
                  hit.task,
                  hit.task.projectId ? projectName(projects, hit.task.projectId) : ''
                )}
              </Text>

              {/* Why this row is here, when the reason is not the title. A note
                  can run for paragraphs, so show the part that matched. */}
              {hit.field === 'notes' ? (
                <Text style={s.excerpt} numberOfLines={2}>
                  {excerpt(hit.task.notes, folded)}
                </Text>
              ) : hit.field === 'owePerson' ? (
                <Text style={s.excerpt} numberOfLines={1}>{hit.task.owePerson}</Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 18 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: {
    flex: 1,
    fontFamily: SANS, fontSize: 15, color: COLORS.ink,
    paddingVertical: 6,
  },
  action: {
    fontFamily: SANS, fontSize: 10.5, fontWeight: '700', letterSpacing: 1,
    color: COLORS.inkSoft,
  },
  rule: { height: 1, backgroundColor: COLORS.pencil, marginTop: 8 },

  note: {
    fontFamily: SERIF, fontSize: 13.5, fontStyle: 'italic', lineHeight: 20,
    color: COLORS.inkFaint, marginTop: 16,
  },
  count: {
    fontFamily: SERIF, fontSize: 12, fontStyle: 'italic',
    color: COLORS.inkFaint, marginTop: 14,
  },
  row: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  title: { fontFamily: SANS, fontSize: 14.5, lineHeight: 19, color: COLORS.ink },
  struck: { color: COLORS.done, textDecorationLine: 'line-through' },
  where: {
    fontFamily: SERIF, fontSize: 12, fontStyle: 'italic',
    color: COLORS.inkFaint, marginTop: 2,
  },
  excerpt: {
    fontFamily: SERIF, fontSize: 13, lineHeight: 18,
    color: COLORS.inkSoft, marginTop: 4,
  },
});
