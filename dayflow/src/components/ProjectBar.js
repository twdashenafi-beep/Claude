import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { EVERYTHING, cleanProjectName } from '../services/projects';
import { COLORS, SANS, SERIF } from '../utils/theme';

// The row of projects, like tabs on a folder.
//
// Everything is a tab rather than a separate idea: a task with no project is in
// the main list, and the main list is the leftmost tab. One mental model, and
// nowhere for a task to fall between the two.
export default function ProjectBar({
  projects, active, onSelect, onCreate, onRename, onDelete,
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const submit = () => {
    const result = cleanProjectName(name, projects);
    if (!result.ok) return setError(result.error);
    onCreate(result.name);
    setName(''); setError(''); setAdding(false);
  };

  const submitRename = () => {
    const others = projects.filter(p => p.id !== editing.id);
    const result = cleanProjectName(editing.name, others);
    if (!result.ok) return setError(result.error);
    onRename(editing.id, result.name);
    setEditing(null); setError('');
  };

  const tab = (id, label) => {
    const on = active === id;
    return (
      <TouchableOpacity
        key={id || 'everything'}
        onPress={() => onSelect(id)}
        // A second tap on the project you are already in renames it, which is
        // where you would look for that and costs no extra furniture.
        onLongPress={() => { if (id) { setEditing({ id, name: label }); setError(''); } }}
        delayLongPress={450}
        style={[s.tab, on && s.tabOn]}
        accessibilityRole="tab"
        aria-selected={on}
        accessibilityLabel={id ? `Project ${label}` : 'All tasks not in a project'}
        accessibilityHint={id ? 'Hold to rename or delete.' : undefined}
      >
        <Text style={[s.tabText, on && s.tabTextOn]} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
    );
  };

  if (editing) {
    return (
      <View style={s.wrap}>
        <View style={s.editRow}>
          <TextInput
            style={s.input}
            value={editing.name}
            onChangeText={t => setEditing({ ...editing, name: t })}
            onSubmitEditing={submitRename}
            autoFocus
            accessibilityLabel="Project name"
            placeholder="Project name"
            placeholderTextColor={COLORS.inkFaint}
          />
          <TouchableOpacity onPress={submitRename} accessibilityRole="button" accessibilityLabel="Save the project name">
            <Text style={s.action}>SAVE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { onDelete(editing.id); setEditing(null); setError(''); }}
            accessibilityRole="button"
            accessibilityLabel={`Delete the project ${editing.name}`}
          >
            <Text style={[s.action, s.danger]}>DELETE</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setEditing(null); setError(''); }} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={s.action}>CANCEL</Text>
          </TouchableOpacity>
        </View>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Text style={s.note}>Deleting a project returns its tasks to Everything.</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.row} accessibilityRole="tablist">
          {tab(EVERYTHING, 'Everything')}
          {projects.map(p => tab(p.id, p.name))}

          {adding ? (
            <View style={s.editRow}>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                onSubmitEditing={submit}
                autoFocus
                placeholder="Project name"
                placeholderTextColor={COLORS.inkFaint}
                accessibilityLabel="New project name"
              />
              <TouchableOpacity onPress={submit} accessibilityRole="button" accessibilityLabel="Create the project">
                <Text style={s.action}>ADD</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setAdding(false); setName(''); setError(''); }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={s.action}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => { setAdding(true); setError(''); }}
              style={s.tab}
              accessibilityRole="button"
              accessibilityLabel="New project"
            >
              <Text style={s.add}>+ New</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tab: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 4,
    maxWidth: 180,
  },
  tabOn: { backgroundColor: COLORS.ink },
  tabText: { fontFamily: SANS, fontSize: 13, color: COLORS.inkSoft },
  tabTextOn: { color: COLORS.sheet, fontWeight: '600' },
  add: { fontFamily: SANS, fontSize: 13, color: COLORS.inkFaint },

  editRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 2 },
  input: {
    fontFamily: SANS, fontSize: 14, color: COLORS.ink, minWidth: 150,
    borderBottomWidth: 1, borderBottomColor: COLORS.rule,
    paddingVertical: 5, outlineStyle: 'none',
  },
  action: {
    fontFamily: SANS, fontSize: 11.5, fontWeight: '700', letterSpacing: 1,
    color: COLORS.inkSoft,
  },
  danger: { color: COLORS.accent },
  error: { fontFamily: SANS, fontSize: 12.5, color: COLORS.accent, marginTop: 8 },
  note: { fontFamily: SERIF, fontSize: 12, fontStyle: 'italic', color: COLORS.inkFaint, marginTop: 8 },
});
