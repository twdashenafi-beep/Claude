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
import { playChime } from '../services/chime';

export default function AccountSheet({ visible, email, dataKey, onClose, onLock, onDeleted }) {
  const [view, setView] = useState('menu'); // menu | password | code | delete
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [typed, setTyped] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const reset = () => {
    setView('menu'); setPassword(''); setConfirm(''); setTyped('');
    setCode(''); setError(''); setDone('');
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
              {/* Somewhere to hear it without setting a task and waiting for
                  it to come due, which is no way to find out whether a sound
                  works. Pressing it is also a gesture, which is what a browser
                  needs before it will play anything at all. */}
              <Row
                label="Reminder sound"
                detail="Play it now"
                onPress={() => playChime()}
              />
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
