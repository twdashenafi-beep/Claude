import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import PaperSheet, { Section, Line, TaskLines, groupStyles } from './PaperSheet';
import { reckon, headline, byPerson, waitedFor, byProject, resultLine } from '../services/reckoning';
import { chaseLabel } from '../services/chase';
import { whenPreview, dueMoment } from '../services/due';

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

export default function WeekReckoning({ visible, onClose, tasks = [], archived = [], projects = [], now }) {
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

  // The three lists of your own work, gathered under the outcome each thing
  // served. Computed here with the summary rather than inside the render, for
  // the same reason the summary is: this page is read, not watched.
  const results = useMemo(() => (sum ? byProject(sum.done, projects) : []), [sum, projects]);
  const stalled = useMemo(() => (sum ? byProject(sum.slipped, projects) : []), [sum, projects]);
  const coming = useMemo(() => (sum ? byProject(sum.ahead, projects) : []), [sum, projects]);
  // What is still open, which is what lets a project's line say whether the
  // result was reached or merely moved.
  const open = useMemo(
    () => [...tasks, ...archived].filter(t => t && !t.completed && !t.archivedAt),
    [tasks, archived],
  );

  if (!sum) return null;

  const wasDue = task => {
    const moment = dueMoment(task);
    return moment ? `was due ${whenPreview(moment.at.toISOString(), task.dueTime, at)}` : '';
  };
  const willBeDue = task => {
    const moment = dueMoment(task);
    return moment ? whenPreview(moment.at.toISOString(), task.dueTime, at) : '';
  };

  // One outcome's worth of a section, under its name. The same shape "Waiting
  // on" has used since this page existed, for the same reason: the thing the
  // list is really about is the heading, not the rows.
  const grouped = (list, noteOf, figureOf) => list.map(group => (
    <View key={group.id || '__everything'} style={groupStyles.group}>
      <View style={groupStyles.head}>
        <Text style={groupStyles.name} dataSet={{ weekproject: 'true' }}>{group.name}</Text>
        {figureOf ? (
          <Text style={groupStyles.figure} dataSet={{ weekresult: 'true' }}>
            {figureOf(group)}
          </Text>
        ) : null}
      </View>
      <TaskLines tasks={group.tasks} noteOf={noteOf} />
    </View>
  ));

  return (
    <PaperSheet
      visible={visible}
      onClose={onClose}
      title="The Week"
      closeLabel="Close the week"
      headline={headline(sum)}
      note={`Since ${whenPreview(sum.from.toISOString(), '', at)}`}
      marker="weeksheet"
    >
      {/* Under the outcome each thing served, because a row of ticks says the
          week was busy and nothing about whether it added up. The figure
          beside a name is the only thing on this page that can say a result
          was reached rather than merely moved. */}
      <Section title="Finished" count={sum.done.length} empty="Nothing finished this week.">
        {grouped(results, null, group => resultLine(group.id, open, at))}
      </Section>

      {/* The week's real news, and the reason this page is worth opening.
          Everything else here is reassurance; this is the part that says
          something has to move. */}
      <Section title="Slipped" count={sum.slipped.length} empty="Nothing past its date.">
        {grouped(stalled, wasDue)}
      </Section>

      <Section title="Next week" count={sum.ahead.length} empty="Nothing dated yet.">
        {grouped(coming, willBeDue)}
      </Section>

      {/* Gathered under the person rather than listed by task, because the
          decision this informs is about a person: one more email, or a phone
          call. */}
      <Section
        title="Waiting on"
        count={sum.waiting.length}
        empty="Nothing owed to you is due yet."
      >
        {groups.map(group => (
          <View key={group.person.toLowerCase()} style={groupStyles.group}>
            <Text style={groupStyles.person}>{group.person}</Text>
            {group.tasks.map(task => (
              <Line
                key={task.id}
                title={task.title}
                note={[waitedFor(task, at), chaseLabel(task)].filter(Boolean).join('  ·  ')}
              />
            ))}
          </View>
        ))}
      </Section>
    </PaperSheet>
  );
}
