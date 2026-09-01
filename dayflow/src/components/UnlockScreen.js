import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { signIn, signUp, getSession, isSupabaseConfigured } from '../services/account';
import { deriveKeys } from '../services/crypto';
import { COLORS, SERIF, SANS, SHEET_MAX_WIDTH } from '../utils/theme';

// Sign in, or unlock this device.
//
// Both paths derive the same key from the same email and password, which is
// what lets three devices read each other's tasks. When cloud sync is not
// configured the screen still works — it just derives the key and opens the
// vault locally, with nothing to sign in to.
export default function UnlockScreen({ onUnlock }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // A stored session means the account is known, but the key is not — it only
    // ever lives in memory, so the password is still required after a restart.
    getSession()
      .then(session => { if (session?.user?.email) setEmail(session.user.email); })
      .finally(() => setChecking(false));
  }, []);

  const submit = async () => {
    setError(''); setNotice('');
    const mail = email.trim();

    if (!mail || !mail.includes('@')) return setError('Enter your email address.');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (mode === 'signup' && password !== confirm) return setError('Passwords do not match.');

    setBusy(true);
    try {
      if (!isSupabaseConfigured) {
        // Local-only build: derive and open, nothing to talk to.
        const { encryptionKey } = await deriveKeys(mail, password);
        return onUnlock({ encryptionKey, synced: false, email: mail });
      }

      if (mode === 'signup') {
        const { encryptionKey, needsConfirmation } = await signUp(mail, password);
        if (needsConfirmation) {
          setNotice('Check your email to confirm the account, then sign in.');
          setMode('signin');
          return;
        }
        return onUnlock({ encryptionKey, synced: true, email: mail });
      }

      const { encryptionKey } = await signIn(mail, password);
      onUnlock({ encryptionKey, synced: true, email: mail });
    } catch (e) {
      const message = String(e.message || e);
      if (/invalid login credentials/i.test(message)) {
        setError('Email or password is incorrect.');
      } else if (/already registered/i.test(message)) {
        setError('That email already has an account. Sign in instead.');
      } else if (/fetch|network/i.test(message)) {
        setError('Could not reach the server. Check your connection.');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <SafeAreaView style={s.desk}>
        <View style={s.center}><ActivityIndicator color={COLORS.ink} /></View>
      </SafeAreaView>
    );
  }

  const isSignup = mode === 'signup';

  return (
    <SafeAreaView style={s.desk}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.sheet}>
            <Text style={s.wordmark}>DayFlow</Text>
            <Text style={s.title}>{isSignup ? 'Create your account' : 'Welcome back'}</Text>
            <View style={s.rule} />

            <Text style={s.blurb}>
              {isSignup
                ? 'Your password encrypts everything on your device before it is stored or synced. It is never sent anywhere, and it cannot be reset — if you lose it, the tasks are gone.'
                : 'Sign in on each device with the same email and password, and they will share the same encrypted tasks.'}
            </Text>

            <TextInput
              style={s.input}
              placeholder="Email"
              placeholderTextColor={COLORS.inkFaint}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <TextInput
              style={s.input}
              placeholder="Master password"
              placeholderTextColor={COLORS.inkFaint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              onSubmitEditing={isSignup ? undefined : submit}
            />
            {isSignup ? (
              <TextInput
                style={s.input}
                placeholder="Confirm password"
                placeholderTextColor={COLORS.inkFaint}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                onSubmitEditing={submit}
              />
            ) : null}

            {error ? <Text style={s.error}>{error}</Text> : null}
            {notice ? <Text style={s.notice}>{notice}</Text> : null}

            <TouchableOpacity
              style={[s.button, busy && s.buttonBusy]}
              onPress={submit}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={COLORS.sheet} />
              ) : (
                <Text style={s.buttonText}>{isSignup ? 'Create account' : 'Unlock'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { setMode(isSignup ? 'signin' : 'signup'); setError(''); setNotice(''); }}
            >
              <Text style={s.switch}>
                {isSignup ? 'I already have an account' : 'Create an account'}
              </Text>
            </TouchableOpacity>

            {!isSupabaseConfigured ? (
              <Text style={s.footnote}>
                Cloud sync is not configured on this build — tasks stay on this device.
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  desk: { flex: 1, backgroundColor: COLORS.desk },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: {
    width: '100%', maxWidth: Math.min(SHEET_MAX_WIDTH, 420),
    backgroundColor: COLORS.sheet, paddingHorizontal: 30, paddingVertical: 34,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.sheetEdge,
    shadowColor: '#3B3628', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14, shadowRadius: 18, elevation: 3,
  },
  wordmark: {
    fontFamily: SERIF, fontSize: 12.5, letterSpacing: 3,
    textTransform: 'uppercase', color: COLORS.inkSoft,
  },
  title: { fontFamily: SERIF, fontSize: 25, color: COLORS.ink, marginTop: 10 },
  rule: { height: 1, backgroundColor: COLORS.pencil, marginTop: 12 },
  blurb: {
    fontFamily: SERIF, fontSize: 13.5, fontStyle: 'italic', lineHeight: 20,
    color: COLORS.inkSoft, marginTop: 16, marginBottom: 20,
  },
  input: {
    fontFamily: SANS, fontSize: 15.5, color: COLORS.ink,
    borderBottomWidth: 1, borderBottomColor: COLORS.rule,
    paddingVertical: 10, marginBottom: 14, outlineStyle: 'none',
  },
  error: { fontFamily: SANS, fontSize: 13, color: COLORS.accent, marginBottom: 10 },
  notice: { fontFamily: SANS, fontSize: 13, color: COLORS.inkSoft, marginBottom: 10 },
  button: {
    backgroundColor: COLORS.ink, paddingVertical: 14, alignItems: 'center', marginTop: 6,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: {
    fontFamily: SANS, fontSize: 14, fontWeight: '600', color: COLORS.sheet,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  switch: {
    fontFamily: SANS, fontSize: 13, color: COLORS.inkSoft,
    textAlign: 'center', marginTop: 18,
  },
  footnote: {
    fontFamily: SERIF, fontSize: 12, fontStyle: 'italic', color: COLORS.inkFaint,
    textAlign: 'center', marginTop: 18, lineHeight: 17,
  },
});
