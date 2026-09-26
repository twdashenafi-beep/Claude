import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import PaperSheet, { Section, Line, TaskLines, groupStyles } from './PaperSheet';
import { brief, headline, finishedNote } from '../services/briefing';
import { byPerson, waitedFor } from '../services/reckoning';
import { chaseLabel } from '../services/chase';
import { COLORS } from '../utils/theme';
import { whenPreview, dueMoment } from '../services/due';
import { clockOf, dayLoad, loadLine } from '../services/agenda';
import { tasksFor, meetingNote } from '../services/meetings';
import { getDailySummary, isAIConfigured } from '../services/ai';

// The day, briefed.
//
// This page used to be a different app: an iOS-blue card, a percentage bar, a
// ring of statistics, and a rotating line of encouragement — "Small progress is
// still progress." Everything else in DayFlow is paper, a serif heading and a
// red pen, and has no opinion about how you feel. Worse than the mismatch, for
// anybody running a real week, was the tone: a person reading this at seven in
// the morning does not need to be told they have got this.
//
// So it now asks the morning's four questions in the same shape the Friday page
// asks the week's, and then stops. What is late, what today holds, who is
// holding something of yours, and what arrives tomorrow.

export default function DailyBriefing({
  visible, onClose, tasks = [], archived = [], diary = null, now,
}) {
  const at = useMemo(() => (now ? new Date(now) : new Date()), [visible, now]);
  const sum = useMemo(
    () => (visible ? brief(tasks, archived, at) : null),
    [visible, tasks, archived, at],
  );
  const groups = useMemo(() => (sum ? byPerson(sum.waiting) : []), [sum]);
  // The hours already spoken for, when there is a calendar to read them from.
  const load = useMemo(
    () => (visible && diary ? dayLoad(tasks, diary.events, at) : null),
    [visible, diary, tasks, at],
  );

  // The optional Claude summary, kept because it was here and because somebody
  // running their own API server may want it. Off unless EXPO_PUBLIC_API_URL is
  // set: it is the one thing in the app that sends task titles off the device
  // in the clear, and the rest of DayFlow promises the server sees ciphertext.
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !isAIConfigured || !sum) return undefined;
    let dropped = false;
    setLoading(true);
    getDailySummary(sum.today)
      .then(text => { if (!dropped) setSummary(text); })
      .finally(() => { if (!dropped) setLoading(false); });
    return () => { dropped = true; };
  }, [visible]);

  if (!sum) return null;

  // The hour, where there is one. A morning is read down the clock, and a task
  // with no time on it should not be given a fake one.
  const hourOf = task => {
    const moment = dueMoment(task);
    return moment && moment.timed ? task.dueTime : '';
  };
  const wasDue = task => {
    const moment = dueMoment(task);
    return moment ? `was due ${whenPreview(moment.at.toISOString(), task.dueTime, at)}` : '';
  };

  return (
    <PaperSheet
      visible={visible}
      onClose={onClose}
      title="Today"
      closeLabel="Close the briefing"
      headline={headline(sum)}
      note={finishedNote(sum)}
      marker="briefsheet"
    >
      {isAIConfigured && (loading || summary) ? (
        <Section title="Summary" count={summary ? 1 : 0} empty="">
          {loading
            ? <ActivityIndicator size="small" color={COLORS.inkFaint} />
            : <Text style={groupStyles.summary}>{summary}</Text>}
        </Section>
      ) : null}

      {/* What the day already contains, before any of the below is possible.
          A list of fifteen things on a day with two free hours is not a plan,
          and this is the only section that can say so. */}
      {load ? (
        <Section
          title="Diary"
          count={load.events.length}
          empty="Nothing in the calendar today."
        >
          {load.allDay.map(event => (
            <Line key={event.id} title={event.title} note="all day" />
          ))}
          {/* The thing this page exists for. A meeting is not just an hour
              gone; it is an hour you are supposed to walk into with something,
              and what that something is has lived in somebody's head until
              now. Listed under the meeting, in the order they were written,
              with the finished ones marked rather than hidden — "done" is part
              of the answer to "am I ready". */}
          {load.events.filter(e => !e.allDay).map(event => {
            const bring = tasksFor(tasks, event);
            return (
              <View key={event.id}>
                <Line
                  title={event.title}
                  note={[`${clockOf(event.start)}–${clockOf(event.end)}`, meetingNote(bring)]
                    .filter(Boolean).join('  ·  ')}
                />
                {bring.map(item => (
                  <Text
                    key={item.id}
                    style={[groupStyles.bring, item.completed && groupStyles.brought]}
                  >
                    {`${item.completed ? '✓' : '·'}  ${item.title}`}
                  </Text>
                ))}
              </View>
            );
          })}
          {load.events.length ? (
            <Text style={groupStyles.person}>
              {`${loadLine(load)}${load.next ? `  ·  next at ${clockOf(load.next.start)}` : ''}`}
            </Text>
          ) : null}
        </Section>
      ) : null}

      {/* First, because it is the only section that is about a decision you
          have already got wrong once. */}
      <Section title="Late" count={sum.late.length} empty="Nothing carried over.">
        <TaskLines tasks={sum.late} noteOf={wasDue} />
      </Section>

      <Section title="Today" count={sum.today.length} empty="Nothing on today's page.">
        <TaskLines tasks={sum.today} noteOf={hourOf} />
      </Section>

      {/* So that nothing arrives as a surprise, and while there is still an
          evening in which to move it. */}
      <Section title="Tomorrow" count={sum.tomorrow.length} empty="Nothing dated tomorrow.">
        <TaskLines tasks={sum.tomorrow} noteOf={hourOf} />
      </Section>

      {/* Last, because it reads in date order and what somebody else owes you
          is rarely today's deadline. It holds what is due by tomorrow and what
          nobody put a date on at all — a promise a month out is not something
          to act on this morning, and the Friday page still shows every one of
          them. */}
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
