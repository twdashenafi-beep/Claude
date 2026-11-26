import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { safeLink, NEW_TASK, PENDING } from '../services/agentInbox';
import { COLORS, SANS, SERIF, typeSize } from '../utils/theme';

// Tasks other programs have proposed, waiting for a yes or a no.
//
// Nothing here is the task list. Accept makes an ordinary task; Dismiss keeps
// the proposal on record and does nothing else. Every word on this page came
// from a file somebody else wrote, so all of it is shown as plain text — no
// links but the one source link, and that only if it arrived as https.

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function Source({ url, title }) {
  const link = safeLink(url);
  if (!link) return null;
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(link).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={`Open the source of ${title}`}
    >
      <Text style={s.link} numberOfLines={1}>{link}</Text>
    </TouchableOpacity>
  );
}

function Suggestion({ item, targetTitle, onAccept, onDismiss, error }) {
  const isTask = item.type === NEW_TASK;
  const heading = isTask
    ? item.title
    : `Mark “${targetTitle || item.targetId}” as ${item.suggestedStatus === 'done' ? 'done' : 'not done'}`;
  const owner = String(item.owner).trim().toLowerCase() === 'me' ? 'for you' : `owed by ${item.owner}`;

  return (
    <View style={s.row} dataSet={{ suggestion: item.key }}>
      <Text style={s.kind}>{isTask ? 'NEW TASK' : 'STATUS CHANGE'}</Text>
      <Text style={s.title}>{heading}</Text>
      <Text style={s.meta}>
        {[`from ${item.agent}`, item.deal, isTask ? owner : null, item.due ? `due ${item.due}` : null]
          .filter(Boolean).join('  ·  ')}
      </Text>
      {item.notes ? <Text style={s.notes}>{item.notes}</Text> : null}
      {!isTask && item.evidence ? (
        <View style={s.evidence}>
          <Text style={s.evidenceLabel}>Evidence</Text>
          <Text style={s.notes}>{item.evidence}</Text>
        </View>
      ) : null}
      <Source url={item.sourceUrl} title={heading} />
      {error ? <Text style={s.error}>{error}</Text> : null}

      <View style={s.actions}>
        <TouchableOpacity
          style={[s.button, s.accept]}
          onPress={() => onAccept(item.key)}
          accessibilityRole="button"
          accessibilityLabel={`Accept: ${heading}`}
        >
          <Text style={s.acceptText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.button}
          onPress={() => onDismiss(item.key)}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss: ${heading}`}
        >
          <Text style={s.dismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function SuggestedSheet({ inbox, tasks }) {
  const [errors, setErrors] = useState({});
  const [showDecided, setShowDecided] = useState(false);
  const titleOf = id => {
    const t = tasks.find(x => x.agent && x.agent.proposalId === id);
    return t ? t.title : '';
  };

  const accept = async key => {
    const result = await inbox.accept(key);
    setErrors(prev => ({ ...prev, [key]: result && result.error ? result.error : '' }));
  };

  const decided = inbox.suggestions.filter(x => x.status !== PENDING).slice().reverse();
  const check = inbox.lastCheck;

  return (
    <View style={s.wrap}>
      <Text style={s.intro}>
        Proposed by agents through the DayFlow folder in Google Drive. Nothing here is on your page
        until you accept it. Agent names are whatever the file says — anyone who can write to that
        folder can use any name — so read before you accept.
      </Text>

      <View style={s.statusRow}>
        <Text style={s.status} numberOfLines={2}>
          {inbox.folder ? `Checking ${inbox.folder} every 15 minutes.` : 'No DayFlow folder yet.'}
          {check ? `  Last check ${when(check.at)}: ${check.error || `${check.added} new, ${check.rejected} rejected`}.` : ''}
        </Text>
        <TouchableOpacity onPress={inbox.checkNow} accessibilityRole="button" accessibilityLabel="Check the inbox now">
          <Text style={s.check}>Check now</Text>
        </TouchableOpacity>
      </View>

      <View style={s.rule} />

      {inbox.pending.length === 0 ? (
        <Text style={s.empty}>Nothing waiting. New proposals appear here when an agent drops a file in DayFlow/agent-inbox.</Text>
      ) : inbox.pending.map(item => (
        <Suggestion
          key={item.key}
          item={item}
          targetTitle={item.type === NEW_TASK ? '' : titleOf(item.targetId)}
          onAccept={accept}
          onDismiss={inbox.dismiss}
          error={errors[item.key]}
        />
      ))}

      {decided.length ? (
        <TouchableOpacity style={s.fold} onPress={() => setShowDecided(v => !v)} accessibilityRole="button">
          <Text style={s.foldText}>{`${decided.length} decided`}</Text>
          <Text style={s.foldAct}>{showDecided ? 'Fold away' : 'Show'}</Text>
        </TouchableOpacity>
      ) : null}
      {showDecided ? decided.map(item => (
        <View key={item.key} style={s.decided}>
          <Text style={s.decidedTitle} numberOfLines={2}>
            {item.type === NEW_TASK ? item.title : `Status change for ${titleOf(item.targetId) || item.targetId}`}
          </Text>
          <Text style={s.meta}>{`${item.status}  ·  from ${item.agent}  ·  ${item.deal}  ·  ${when(item.decidedAt)}`}</Text>
        </View>
      )) : null}

      <View style={s.exportBox}>
        <View style={s.statusRow}>
          <Text style={s.exportTitle}>Write my tasks to Google Drive</Text>
          <TouchableOpacity
            onPress={() => inbox.setExportOn(!inbox.exportOn)}
            accessibilityRole="switch"
            aria-checked={inbox.exportOn}
            accessibilityLabel="Write my tasks to Google Drive"
          >
            <Text style={[s.toggle, inbox.exportOn && s.toggleOn]}>{inbox.exportOn ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.notes}>
          When on, every change writes your whole task list, unencrypted, to
          DayFlow/export/dayflow-export.json, so agents can see what you accepted, dismissed and
          finished. Everyone who can open that Drive folder can read it. Off by default.
        </Text>
        {inbox.exportOn && inbox.lastExport ? (
          <Text style={s.meta}>
            {inbox.lastExport.error ? `Last write failed: ${inbox.lastExport.error}` : `Last written ${when(inbox.lastExport.at)}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 20 },
  intro: { fontFamily: SERIF, fontSize: typeSize(13), fontStyle: 'italic', lineHeight: typeSize(19), color: COLORS.inkSoft },
  statusRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginTop: 12 },
  status: { flex: 1, fontFamily: SERIF, fontSize: typeSize(12), fontStyle: 'italic', color: COLORS.inkFaint },
  check: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent },
  rule: { height: 1, backgroundColor: COLORS.pencil, marginTop: 10 },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule },
  kind: { fontFamily: SANS, fontSize: typeSize(10), fontWeight: '700', letterSpacing: 1.2, color: COLORS.inkFaint },
  title: { fontFamily: SANS, fontSize: typeSize(15), lineHeight: typeSize(20), color: COLORS.ink, marginTop: 3 },
  meta: { fontFamily: SERIF, fontSize: typeSize(12), fontStyle: 'italic', color: COLORS.inkFaint, marginTop: 3 },
  notes: { fontFamily: SERIF, fontSize: typeSize(13), lineHeight: typeSize(19), color: COLORS.inkSoft, marginTop: 6 },
  evidence: { marginTop: 8, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: COLORS.pencil },
  evidenceLabel: { fontFamily: SANS, fontSize: typeSize(10), fontWeight: '700', letterSpacing: 1, color: COLORS.inkFaint },
  link: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent, textDecorationLine: 'underline', marginTop: 6 },
  error: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  button: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 5, borderWidth: 1, borderColor: COLORS.pencil },
  accept: { backgroundColor: COLORS.ink, borderColor: COLORS.ink },
  acceptText: { fontFamily: SANS, fontSize: typeSize(13), fontWeight: '600', color: '#FFFFFF' },
  dismissText: { fontFamily: SANS, fontSize: typeSize(13), color: COLORS.inkSoft },
  empty: { fontFamily: SERIF, fontSize: typeSize(13.5), fontStyle: 'italic', lineHeight: typeSize(20), color: COLORS.inkFaint, marginTop: 14 },
  fold: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  foldText: { fontFamily: SERIF, fontStyle: 'italic', fontSize: typeSize(12.5), color: COLORS.inkFaint },
  foldAct: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent, marginLeft: 12 },
  decided: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule },
  decidedTitle: { fontFamily: SANS, fontSize: typeSize(14), color: COLORS.done },
  exportBox: { marginTop: 28, padding: 12, borderWidth: 1, borderColor: COLORS.pencil, borderRadius: 6 },
  exportTitle: { flex: 1, fontFamily: SANS, fontSize: typeSize(14), fontWeight: '600', color: COLORS.ink },
  toggle: { fontFamily: SANS, fontSize: typeSize(11), fontWeight: '700', letterSpacing: 1.2, color: COLORS.inkFaint },
  toggleOn: { color: COLORS.accent },
});
