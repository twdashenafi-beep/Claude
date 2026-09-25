import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView,
  ActivityIndicator, Platform,
} from 'react-native';
import { changePassword, newRecoveryCode, deleteAccount } from '../services/account';
import { COLORS, SERIF, SANS } from '../utils/theme';

// Account settings: change the password, issue a new recovery code, delete the
// account. Deletion has to be reachable in-app — App Store Guideline 5.1.1(v)
// rejects any app that offers sign-up without it — and it is deliberately the
// last item, behind a typed confirmation, because nothing about it is undoable.
import { playChime, chimeAvailable } from '../services/chime';
import { pullTasks } from '../services/sync';
import { inspectRows } from '../services/leak';
import { buildBackup, backupText, backupFilename, describe } from '../services/backup';
import { saveTextFile } from '../services/saveFile';

// What to say after trying to play it. The first case is the interesting one:
// the browser reports a sound played, so if none was heard the cause is
// outside the app — on an iPhone or iPad, almost always the silent switch,
// which mutes web audio without muting anything else.
const SOUND_RESULT = {
  played: 'Played. Heard nothing? Check the silent switch',
  blocked: 'Your browser blocked it — tap anywhere, then try again',
  unavailable: 'This device has no sound to play',
  failed: 'Could not play it',
};

// What to say after trying to write the file. Cancelling is not a failure and
// must not read like one; the two that are failures say which one it is.
const SAVE_RESULT = {
  cancelled: 'Cancelled — nothing was saved',
  toolarge: 'Too large to send from here — export from the browser instead',
  unavailable: 'This device cannot save a file',
};

export default function AccountSheet({
  visible, email, dataKey, tasks = [], archived = [], projects = [],
  onClose, onLock, onDeleted,
}) {
  const [view, setView] = useState('menu'); // menu | password | code | delete
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [typed, setTyped] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // What happened the last time the chime was asked to play. A button that
  // makes a sound has nothing to show when it makes none, and "nothing
  // happened" is the one answer that leaves you no wiser.
  const [sound, setSound] = useState('');
  // What the server turned out to be holding, last time it was asked.
  const [seen, setSeen] = useState('');
  const [exposed, setExposed] = useState(false);
  // What happened the last time a copy was asked for.
  const [saved, setSaved] = useState('');

  const reset = () => {
    setView('menu'); setPassword(''); setConfirm(''); setTyped('');
    setCode(''); setError(''); setDone('');
  };

  // Ask the server what it has, and read it back the way an intruder would.
  //
  // The rows come from the same call sync uses, before anything decrypts them,
  // so what is examined here is exactly what is stored — not a copy the app has
  // already made sense of.
  const checkEncryption = async () => {
    setSeen('Asking the server…');
    setExposed(false);
    try {
      const rows = await pullTasks();
      if (!rows) {
        setSeen('This device only — nothing is sent anywhere');
        return;
      }
      const result = inspectRows(rows, tasks.map(t => t && t.title));
      if (result.verdict === 'empty') {
        setSeen('Nothing has reached the server yet');
      } else if (result.verdict === 'exposed') {
        setExposed(true);
        setSeen(`Readable — ${result.reason}`);
      } else {
        // The sample is the point. "It is encrypted" is a claim; the first
        // characters of the row itself are the thing you came to see.
        setSeen(`Unreadable · ${result.sample}… · ${result.checked} rows`);
      }
    } catch (e) {
      setSeen(`Could not ask: ${String(e.message || e)}`);
    }
  };

  // Everything, in a file you keep.
  //
  // The vault is encrypted with a key derived from a password nothing can
  // recover — that is the point of it, and it is also why this has to exist.
  // One forgotten password and the tasks are gone for good, and until now there
  // was no way to hold a copy of what was in there.
  //
  // Nothing is awaited before the file is handed over. A browser only allows a
  // share sheet during the gesture that asked for one, and an await here would
  // spend that permission before the sheet was ever reached.
  const exportCopy = async () => {
    setSaved('Gathering…');
    try {
      const backup = buildBackup({ tasks, archived, projects, email });
      const text = backupText(backup);
      const result = await saveTextFile(backupFilename(), text);
      setSaved(result === 'saved'
        ? `Saved · ${describe(backup, text)}`
        : SAVE_RESULT[result] || 'Could not save it');
    } catch (e) {
      setSaved(`Could not save it: ${String(e.message || e)}`);
    }
  };

  const close = () => { reset(); onClose(); };

  const submitPassword = async () => {
    setError('');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await changePassword(email, dataKey, password);
      setDone('Password changed. Use it on your other devices from now on.');
      setPassword(''); setConfirm('');
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const rotateCode = async () => {
    setError(''); setBusy(true);
    try {
      setCode(await newRecoveryCode(email, dataKey));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setError(''); setBusy(true);
    try {
      await deleteAccount();
      onDeleted();
    } catch (e) {
      // Local data is wiped either way, so the account is unusable here
      // regardless — but the server copy may survive and the user needs to know.
      setError(
        'Your data was removed from this device, but the account may still exist on the server. ' +
        String(e.message || e)
      );
      setBusy(false);
    }
  };

  const Row = ({ label, detail, onPress, danger }) => (
    <TouchableOpacity
      style={s.row}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
    >
      <View style={s.rowText}>
        <Text style={[s.rowLabel, danger && s.danger]}>{label}</Text>
        {detail ? <Text style={s.rowDetail}>{detail}</Text> : null}
      </View>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity
            onPress={view === 'menu' ? close : reset}
            style={s.headerHit}
            accessibilityRole="button"
            accessibilityLabel={view === 'menu' ? 'Close account settings' : 'Back to account settings'}
          >
            <Text style={s.headerAction}>{view === 'menu' ? 'Done' : 'Back'}</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle} accessibilityRole="header">
            {view === 'menu' ? 'Account'
              : view === 'password' ? 'Change password'
              : view === 'code' ? 'Recovery code'
              : 'Delete account'}
          </Text>
          <View style={{ width: 46 }} />
        </View>

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {view === 'menu' ? (
            <>
              <Text style={s.email}>{email || 'This device only'}</Text>
              <View style={s.rule} />
              <Row label="Change password" detail="Your tasks are not re-encrypted" onPress={() => setView('password')} />
              <Row label="New recovery code" detail="Replaces the code you saved" onPress={() => setView('code')} />
              {/* The other half of not being locked out. A recovery code gets
                  you back into the account; this is what you would have left if
                  the vault itself were gone. It sits with the password and the
                  code because all three are the same worry. */}
              <Row
                label="Export a copy"
                detail={saved || 'Every task, in one file you keep'}
                onPress={exportCopy}
              />
              {/* Somewhere to hear it without setting a task and waiting for
                  it to come due, which is no way to find out whether a sound
                  works. Pressing it is also a gesture, which is what a browser
                  needs before it will play anything at all. */}
              {chimeAvailable() ? (
                <Row
                  label="Reminder sound"
                  detail={sound || 'Play it now'}
                  onPress={async () => {
                    setSound('Playing…');
                    const result = await playChime();
                    setSound(SOUND_RESULT[result] || SOUND_RESULT.failed);
                  }}
                />
              ) : null}
              {/* The app's central claim, checked rather than asserted. It
                  pulls its own rows back and looks for anything readable in
                  them, which is the check that otherwise means a desk, a
                  dashboard and a column of base64 — so in practice never. */}
              {email ? (
                <Row
                  label="Encryption"
                  detail={seen || 'See what the server is holding'}
                  danger={exposed}
                  onPress={checkEncryption}
                />
              ) : null}
              <Row label="Lock" detail="Close the vault on this device" onPress={() => { close(); onLock(); }} />
              <View style={s.gap} />
              <Row label="Delete account" detail="Permanent" danger onPress={() => setView('delete')} />
            </>
          ) : null}

          {view === 'password' ? (
            <>
              <Text style={s.blurb}>
                Your tasks are encrypted with a key your password only wraps, so
                changing it re-seals that one key and leaves every task exactly
                as it is. Your recovery code keeps working.
              </Text>
              <TextInput
                style={s.input} placeholder="New password" placeholderTextColor={COLORS.inkFaint}
                secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword}
              />
              <TextInput
                style={s.input} placeholder="Confirm new password" placeholderTextColor={COLORS.inkFaint}
                secureTextEntry autoCapitalize="none" value={confirm} onChangeText={setConfirm}
              />
              {error ? <Text style={s.error}>{error}</Text> : null}
              {done ? <Text style={s.done}>{done}</Text> : null}
              <TouchableOpacity style={[s.button, busy && s.busy]} onPress={submitPassword} disabled={busy}>
                {busy ? <ActivityIndicator color={COLORS.sheet} /> : <Text style={s.buttonText}>Change password</Text>}
              </TouchableOpacity>
            </>
          ) : null}

          {view === 'code' ? (
            <>
              <Text style={s.blurb}>
                Issuing a new code invalidates the old one immediately. Save this
                one before you leave — it is shown once.
              </Text>
              {code ? (
                <View style={s.codeBox}><Text style={s.code} selectable>{code}</Text></View>
              ) : null}
              {error ? <Text style={s.error}>{error}</Text> : null}
              <TouchableOpacity style={[s.button, busy && s.busy]} onPress={rotateCode} disabled={busy}>
                {busy ? <ActivityIndicator color={COLORS.sheet} />
                      : <Text style={s.buttonText}>{code ? 'Generate another' : 'Generate new code'}</Text>}
              </TouchableOpacity>
            </>
          ) : null}

          {view === 'delete' ? (
            <>
              <Text style={s.blurb}>
                This deletes your account and every task in it, on this device and
                on the server. It cannot be undone, and your recovery code will
                not bring it back — there will be nothing left to recover.
              </Text>
              <Text style={s.confirmLabel}>Type DELETE to confirm</Text>
              <TextInput
                accessibilityLabel="Type the word DELETE to confirm"
                style={s.input} placeholder="DELETE" placeholderTextColor={COLORS.inkFaint}
                autoCapitalize="characters" autoCorrect={false}
                value={typed} onChangeText={setTyped}
              />
              {error ? <Text style={s.error}>{error}</Text> : null}
              <TouchableOpacity
                style={[s.button, s.dangerButton, (busy || typed.trim().toUpperCase() !== 'DELETE') && s.busy]}
                onPress={confirmDelete}
                disabled={busy || typed.trim().toUpperCase() !== 'DELETE'}
                accessibilityRole="button"
                aria-disabled={busy || typed.trim().toUpperCase() !== 'DELETE'}
                accessibilityLabel="Permanently delete my account and all tasks"
              >
                {busy ? <ActivityIndicator color={COLORS.sheet} />
                      : <Text style={s.buttonText}>Delete my account</Text>}
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.sheet },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  // Seventeen pixels of text, and the only way out of this sheet.
  headerHit: { paddingVertical: 11, paddingRight: 16, marginVertical: -11, marginRight: -16 },
  headerAction: { fontFamily: SANS, fontSize: 15, color: COLORS.accent, width: 46 },
  headerTitle: { fontFamily: SERIF, fontSize: 16, color: COLORS.ink },
  body: { padding: 20 },

  email: { fontFamily: SERIF, fontSize: 17, color: COLORS.ink },
  rule: { height: 1, backgroundColor: COLORS.pencil, marginTop: 12, marginBottom: 4 },
  gap: { height: 26 },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  rowText: { flex: 1 },
  rowLabel: { fontFamily: SANS, fontSize: 15.5, color: COLORS.ink },
  rowDetail: { fontFamily: SERIF, fontSize: 12.5, fontStyle: 'italic', color: COLORS.inkFaint, marginTop: 2 },
  danger: { color: COLORS.accent },
  chevron: { fontSize: 20, color: COLORS.inkFaint, fontWeight: '300' },

  blurb: {
    fontFamily: SERIF, fontSize: 13.5, fontStyle: 'italic', lineHeight: 20,
    color: COLORS.inkSoft, marginBottom: 20,
  },
  input: {
    fontFamily: SANS, fontSize: 15.5, color: COLORS.ink,
    borderBottomWidth: 1, borderBottomColor: COLORS.rule,
    paddingVertical: 10, marginBottom: 14, outlineStyle: 'none',
  },
  confirmLabel: {
    fontFamily: SANS, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
    color: COLORS.inkSoft, marginBottom: 6,
  },
  error: { fontFamily: SANS, fontSize: 13, color: COLORS.accent, marginBottom: 10, lineHeight: 18 },
  done: { fontFamily: SANS, fontSize: 13, color: COLORS.inkSoft, marginBottom: 10 },

  codeBox: { borderWidth: 1, borderColor: COLORS.pencil, paddingVertical: 16, paddingHorizontal: 10, marginBottom: 16 },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' }),
    fontSize: 15, letterSpacing: 1.4, textAlign: 'center', color: COLORS.ink, lineHeight: 24,
  },

  button: { backgroundColor: COLORS.ink, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  dangerButton: { backgroundColor: COLORS.accent },
  busy: { opacity: 0.45 },
  buttonText: {
    fontFamily: SANS, fontSize: 14, fontWeight: '600', color: COLORS.sheet,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
});
