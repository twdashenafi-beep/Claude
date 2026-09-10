import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Animated, PanResponder,
} from 'react-native';
import { EVERYTHING, cleanProjectName } from '../services/projects';
import { ARCHIVE } from '../services/archive';
import { targetIndex, shiftFor, moveWithin } from '../services/ordering';
import { COLORS, SANS, SERIF } from '../utils/theme';

// The gap between tabs, which is part of how far one has to travel to pass
// another and so belongs in the measurement.
const GAP = 6;

// One tab.
//
// Its own component so it can own a PanResponder. Everything the handlers read
// comes from a ref, because PanResponder.create captures its closure the first
// time it runs — the second drag of a session would otherwise be computed
// against the order as it stood before the first.
function ProjectTab({
  id, label, index, on, lifted, dragging, shift,
  onSelect, onRename, onLift, onMove, onDrop, onRelease, onMeasure,
}) {
  const live = useRef({});
  live.current = { lifted, onMove, onDrop };

  const responder = useRef(null);
  if (!responder.current) {
    responder.current = PanResponder.create({
      // Claimed only once the tab has been picked up. Until then the row is
      // free to scroll, which is the whole reason the lift exists: a bar of
      // tabs that scrolls sideways cannot also be dragged sideways.
      onMoveShouldSetPanResponder: (_e, g) => live.current.lifted && Math.abs(g.dx) > 3,
      onPanResponderMove: (_e, g) => live.current.onMove(g.dx),
      onPanResponderRelease: () => live.current.onDrop(),
      onPanResponderTerminate: () => live.current.onDrop(),
    });
  }

  return (
    <Animated.View
      dataSet={{ projecttab: 'true' }}
      onLayout={e => onMeasure(index, e.nativeEvent.layout.width + GAP)}
      style={[
        dragging ? s.lifted : null,
        { transform: [{ translateX: shift }] },
      ]}
      {...(id ? responder.current.panHandlers : {})}
    >
      <TouchableOpacity
        onPress={() => (on && id ? onRename() : onSelect(id))}
        // Holding a tab picks it up; sliding it sideways then puts it where you
        // want it. Renaming moved to a second tap on the tab you are already
        // on, which is where this file said it lived long before it did.
        onLongPress={() => { if (id) onLift(index); }}
        // The pan responder only claims the gesture once the finger actually
        // moves, so a tab picked up and put straight back down never reaches
        // onPanResponderRelease — it stayed lifted, and the row stayed locked.
        // This is the one event that always arrives.
        onPressOut={() => { if (id) onRelease(index); }}
        delayLongPress={300}
        style={[s.tab, on && s.tabOn, lifted && s.tabLifted]}
        accessibilityRole="tab"
        aria-selected={on}
        accessibilityLabel={id ? `Project ${label}` : 'All tasks not in a project'}
        accessibilityHint={
          id
            ? 'Hold to pick it up and drag it along the row, or hold and let go to rename, move or delete it.'
            : undefined
        }
      >
        <Text style={[s.tabText, on && s.tabTextOn]} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// The row of projects, like tabs on a folder.
//
// Everything is a tab rather than a separate idea: a task with no project is in
// the main list, and the main list is the leftmost tab. One mental model, and
// nowhere for a task to fall between the two.
export default function ProjectBar({
  projects, active, onSelect, onCreate, onRename, onDelete, onReorder,
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  // Which tab has been picked up, how far it has been carried, and where it
  // would land if let go now.
  const [lifted, setLifted] = useState(null);
  const [target, setTarget] = useState(null);
  const dragX = useRef(new Animated.Value(0)).current;
  const widths = useRef([]);
  const liveProjects = useRef(projects);
  liveProjects.current = projects;

  const measure = useCallback((index, width) => { widths.current[index] = width; }, []);

  const lift = useCallback(index => {
    carried.current = false;
    clearTimeout(releaseTimer.current);
    liftedRef.current = index;
    setLifted(index);
    setTarget(index);
    dragX.setValue(0);
  }, [dragX]);

  // Whether the tab in hand was actually carried anywhere, and a mirror of what
  // is lifted that a timer can read without going through React.
  const carried = useRef(false);
  const liftedRef = useRef(null);
  const releaseTimer = useRef(null);
  useEffect(() => () => clearTimeout(releaseTimer.current), []);

  const move = useCallback(dx => {
    carried.current = true;
    dragX.setValue(dx);
    setLifted(from => {
      if (from === null) return from;
      setTarget(targetIndex(widths.current, from, dx));
      return from;
    });
  }, [dragX]);

  const drop = useCallback(() => {
    clearTimeout(releaseTimer.current);
    liftedRef.current = null;
    setLifted(from => {
      setTarget(to => {
        if (from !== null && to !== null && from !== to && onReorder) {
          const changes = moveWithin(liveProjects.current, from, to);
          if (changes.length) onReorder(changes);
        }
        return null;
      });
      return null;
    });
    dragX.setValue(0);
  }, [dragX, onReorder]);

  // Picked up and put straight back down. Holding a tab and letting go without
  // carrying it anywhere is what a long press meant before this row could be
  // dragged at all, so it still opens the editor — the two gestures share a
  // beginning and are told apart by whether anything moved.
  const release = useCallback((index, openEditor) => {
    // The touchable and the pan responder both report the end of a gesture, and
    // not in a fixed order — the touchable is told the gesture was taken away
    // before the responder has said it took it. Deciding on the spot read every
    // drag as a press-and-let-go and opened the editor instead of moving the
    // tab. So the decision waits a moment for the drag to declare itself.
    clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      if (carried.current || liftedRef.current !== index) return;
      liftedRef.current = null;
      setLifted(null);
      setTarget(null);
      dragX.setValue(0);
      openEditor();
    }, 160);
  }, [dragX]);

  // Moving without dragging. A tab is a small target on a phone, and a row that
  // scrolls sideways is an awkward place to hold one still — the same reason
  // the task rows carry buttons beside the handle.
  const nudge = useCallback((id, by) => {
    const from = liveProjects.current.findIndex(p => p.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(liveProjects.current.length - 1, from + by));
    const changes = moveWithin(liveProjects.current, from, to);
    if (changes.length && onReorder) onReorder(changes);
  }, [onReorder]);

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

  if (editing) {
    const at = projects.findIndex(p => p.id === editing.id);
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

        {/* Greyed at the ends rather than hidden, so the row does not change
            shape as a project reaches one. */}
        <View style={s.moveRow}>
          <Text style={s.moveLabel}>Position</Text>
          <TouchableOpacity
            onPress={() => nudge(editing.id, -1)}
            disabled={at <= 0}
            accessibilityRole="button"
            accessibilityLabel={`Move ${editing.name} left`}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[s.action, at <= 0 && s.disabled]}>◀ LEFT</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => nudge(editing.id, 1)}
            disabled={at < 0 || at >= projects.length - 1}
            accessibilityRole="button"
            accessibilityLabel={`Move ${editing.name} right`}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[s.action, (at < 0 || at >= projects.length - 1) && s.disabled]}>RIGHT ▶</Text>
          </TouchableOpacity>
          <Text style={s.moveWhere}>{at + 1} of {projects.length}</Text>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}
        <Text style={s.note}>Deleting a project returns its tasks to Everything.</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // A lifted tab is following the finger; the row must hold still while
        // it does, or the two move at once and neither goes where it was sent.
        scrollEnabled={lifted === null}
      >
        <View style={s.row} accessibilityRole="tablist">
          <ProjectTab
            id={EVERYTHING}
            label="Everything"
            index={-1}
            on={active === EVERYTHING}
            lifted={false}
            dragging={false}
            shift={0}
            onSelect={onSelect}
            onRename={() => {}}
            onLift={() => {}}
            onMove={() => {}}
            onDrop={() => {}}
            onRelease={() => {}}
            onMeasure={() => {}}
          />

          {projects.map((p, i) => (
            <ProjectTab
              key={p.id}
              id={p.id}
              label={p.name}
              index={i}
              on={active === p.id}
              lifted={lifted === i}
              dragging={lifted === i}
              shift={
                lifted === i
                  ? dragX
                  : shiftFor(i, lifted, target, widths.current[lifted] || 0)
              }
              onSelect={onSelect}
              onRename={() => { setEditing({ id: p.id, name: p.name }); setError(''); }}
              onLift={lift}
              onMove={move}
              onDrop={drop}
              onRelease={i => release(i, () => { setEditing({ id: p.id, name: p.name }); setError(''); })}
              onMeasure={measure}
            />
          ))}

          {/* Not a project: a place finished work is kept. Sitting at the end
              and set apart, so it is not mistaken for somewhere to work. */}
          <View style={s.spacer} />
          <TouchableOpacity
            onPress={() => onSelect(ARCHIVE)}
            style={[s.tab, s.archiveTab, active === ARCHIVE && s.tabOn]}
            accessibilityRole="tab"
            aria-selected={active === ARCHIVE}
            accessibilityLabel="Archive"
          >
            <Text style={[s.tabText, active === ARCHIVE && s.tabTextOn]}>Archive</Text>
          </TouchableOpacity>

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
  row: { flexDirection: 'row', alignItems: 'center', gap: GAP },
  tab: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 4,
    maxWidth: 180,
  },
  tabOn: { backgroundColor: COLORS.ink },
  tabLifted: { backgroundColor: COLORS.sheetEdge },
  tabText: { fontFamily: SANS, fontSize: 13, color: COLORS.inkSoft },
  tabTextOn: { color: COLORS.sheet, fontWeight: '600' },
  add: { fontFamily: SANS, fontSize: 13, color: COLORS.inkFaint },
  spacer: { width: 10 },
  archiveTab: { borderWidth: 1, borderColor: COLORS.rule, borderStyle: 'dashed' },

  // The tab in hand rides above the others so it is clearly the thing moving.
  lifted: { zIndex: 10, elevation: 4, opacity: 0.94 },

  editRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 2 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  moveLabel: {
    fontFamily: SANS, fontSize: 11.5, fontWeight: '700', letterSpacing: 1,
    color: COLORS.inkFaint,
  },
  moveWhere: { fontFamily: SERIF, fontSize: 12, fontStyle: 'italic', color: COLORS.inkFaint },
  disabled: { color: COLORS.rule },
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
