import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { parseConfig, verifyConfig } from '../services/syncConfig';
import { configureSync } from '../services/supabase';
import { COLORS, SERIF, SANS, SHEET_MAX_WIDTH } from '../utils/theme';

// Connecting this device to a Supabase project.
//
// The two values asked for here are public by design — the anon key is in the
// JavaScript of every Supabase web app — so keeping them out of the build and
// asking once per device costs nothing in security and removes a whole class of
// deployment problem.
//
// The parsing is deliberately generous (see syncConfig): the dashboard address
// works as well as the project URL, the fields can be the wrong way round, and
// a service_role key is refused outright rather than quietly shipping a key
// that bypasses every row policy.
export default function SyncSetup({ onDone, onSkip }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [fixes, setFixes] = useState([]);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setError(''); setFixes([]);

    const parsed = parseConfig(url, key);
    if (parsed.fixes.length) setFixes(parsed.fixes);
    if (!parsed.ok) return setError(parsed.error);

    // Show the corrected values back, so what was accepted is never a surprise.
    setUrl(parsed.config.url);
    setKey(parsed.config.anonKey);

    setBusy(true);
    try {
      const check = await verifyConfig(parsed.config);
      if (!check.ok) return setError(check.error);
      await configureSync(parsed.config);
      onDone();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.desk}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.sheet}>
            <Text style={s.wordmark}>DayFlow</Text>
            <Text style={s.title} accessibilityRole="header">Connect your devices</Text>
            <View style={s.rule} />

            <Text style={s.blurb}>
              To share tasks between your Mac, iPhone and iPad, DayFlow needs the address of
              your Supabase project. Do this once on each device.
            </Text>

            <Text style={s.step}>1.  Open your project at supabase.com</Text>
            <Text style={s.step}>2.  Go to Project Settings, then API Keys</Text>
            <Text style={s.step}>3.  Copy the two values below</Text>

            <Text style={s.label}>Project URL</Text>
            <TextInput
              accessibilityLabel="Supabase project URL"
              accessibilityHint="Looks like https://abcdefghijklmnop.supabase.co"
              style={s.input}
              placeholder="https://….supabase.co"
              placeholderTextColor={COLORS.inkFaint}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={s.hint}>
              Can’t find it? Paste the web address of your Supabase dashboard page instead —
              DayFlow can work it out from that.
            </Text>

            <Text style={s.label}>Anon public key</Text>
            <TextInput
              accessibilityLabel="Supabase anon public key"
              accessibilityHint="The key labelled anon or public. Not the service role key."
              style={[s.input, s.keyInput]}
              placeholder="eyJ… or sb_publishable_…"
              placeholderTextColor={COLORS.inkFaint}
              value={key}
              onChangeText={setKey}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
            <Text style={s.hint}>
              Use the key marked “anon” / “public”. Never the one marked “service_role” or
              “secret” — DayFlow will refuse it.
            </Text>

            {fixes.map(f => <Text key={f} style={s.fix}>{f}</Text>)}
            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[s.button, busy && s.buttonBusy]}
              onPress={connect}
              disabled={busy}
              accessibilityRole="button"
              aria-busy={busy}
              accessibilityLabel="Connect to project"
            >
              {busy
                ? <ActivityIndicator color={COLORS.sheet} />
                : <Text style={s.buttonText}>Connect</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={onSkip} accessibilityRole="button">
              <Text style={s.switch}>Use this device only</Text>
            </TouchableOpacity>

            <Text style={s.footnote}>
              Neither value is a secret: they identify the project, they do not open it. Your
              tasks are encrypted on this device with your master password before anything
              is sent, and the server never sees that password.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  desk: { flex: 1, backgroundColor: COLORS.desk },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: {
    width: '100%', maxWidth: Math.min(SHEET_MAX_WIDTH, 460),
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
    color: COLORS.inkSoft, marginTop: 16, marginBottom: 16,
  },
  step: { fontFamily: SANS, fontSize: 13.5, color: COLORS.ink, lineHeight: 22 },
  label: {
    fontFamily: SANS, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
    color: COLORS.inkSoft, marginTop: 22, marginBottom: 2,
  },
  input: {
    fontFamily: SANS, fontSize: 15, color: COLORS.ink,
    borderBottomWidth: 1, borderBottomColor: COLORS.rule,
    paddingVertical: 10, outlineStyle: 'none',
  },
  keyInput: { minHeight: 62 },
  hint: {
    fontFamily: SANS, fontSize: 12, lineHeight: 17,
    color: COLORS.inkFaint, marginTop: 7,
  },
  fix: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkSoft, marginTop: 12 },
  error: { fontFamily: SANS, fontSize: 13, lineHeight: 19, color: COLORS.accent, marginTop: 14 },
  button: {
    backgroundColor: COLORS.ink, paddingVertical: 14, alignItems: 'center', marginTop: 24,
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
    fontFamily: SANS, fontSize: 11.5, lineHeight: 17,
    color: COLORS.inkFaint, marginTop: 22,
  },
});
