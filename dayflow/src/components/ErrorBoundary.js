import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, SafeAreaView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SERIF, SANS } from '../utils/theme';

const LOG_KEY = '@dayflow_last_error';

// Catches what would otherwise be a white screen.
//
// The hard rule here is that a crash report must never carry task content. In
// an app whose whole claim is that nobody else can read your tasks, a diagnostic
// that quietly ships a title to a logging service would break that promise more
// thoroughly than any bug it helped fix. So what is kept is the error message,
// the stack, and nothing drawn from application state — and it is written to
// this device, not sent anywhere.
//
// If a reporting service is ever added, `onError` is the single place it hooks
// in, and it must be given the same sanitised payload.
export function recordError(error, info) {
  const entry = {
    message: String(error?.message || error),
    // Stack frames name functions and files, not data.
    stack: String(error?.stack || '').split('\n').slice(0, 12).join('\n'),
    componentStack: String(info?.componentStack || '').split('\n').slice(0, 8).join('\n'),
    at: new Date().toISOString(),
  };
  AsyncStorage.setItem(LOG_KEY, JSON.stringify(entry)).catch(() => {});
  return entry;
}

export async function readLastError() {
  try {
    const raw = await AsyncStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearLastError() {
  await AsyncStorage.removeItem(LOG_KEY).catch(() => {});
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, entry: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const entry = recordError(error, info);
    this.setState({ entry });
    // Still surface it: a boundary that only swallows makes bugs harder to find
    // than no boundary at all.
    console.error('DayFlow crashed:', error);
    if (this.props.onError) this.props.onError(entry);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { entry } = this.state;
    return (
      <SafeAreaView style={s.desk}>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.sheet}>
            <Text style={s.wordmark}>DayFlow</Text>
            <Text style={s.title} accessibilityRole="header">Something broke</Text>
            <View style={s.rule} />

            <Text style={s.blurb}>
              The app hit an error it could not carry on from. Your tasks are
              untouched — they are encrypted on this device and nothing here
              writes to them.
            </Text>

            <View style={s.box}>
              <Text style={s.mono} selectable>{entry?.message}</Text>
            </View>

            <Text style={s.note}>
              The details above are saved on this device so you can send them if
              you report this. They contain no task content.
            </Text>

            <TouchableOpacity
              style={s.button}
              onPress={() => this.setState({ error: null, entry: null })}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <Text style={s.buttonText}>Try again</Text>
            </TouchableOpacity>

            {this.props.onReset ? (
              <TouchableOpacity
                onPress={this.props.onReset}
                accessibilityRole="button"
                accessibilityLabel="Lock and return to the sign-in screen"
              >
                <Text style={s.secondary}>Lock and start over</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
}

const s = StyleSheet.create({
  desk: { flex: 1, backgroundColor: COLORS.desk },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: {
    width: '100%', maxWidth: 460, backgroundColor: COLORS.sheet,
    paddingHorizontal: 30, paddingVertical: 34,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.sheetEdge,
  },
  wordmark: {
    fontFamily: SERIF, fontSize: 12.5, letterSpacing: 3,
    textTransform: 'uppercase', color: COLORS.inkSoft,
  },
  title: { fontFamily: SERIF, fontSize: 25, color: COLORS.ink, marginTop: 10 },
  rule: { height: 1, backgroundColor: COLORS.pencil, marginTop: 12, marginBottom: 18 },
  blurb: {
    fontFamily: SERIF, fontSize: 14, fontStyle: 'italic', lineHeight: 21,
    color: COLORS.inkSoft, marginBottom: 18,
  },
  box: { borderWidth: 1, borderColor: COLORS.rule, padding: 12, marginBottom: 12 },
  mono: { fontFamily: SANS, fontSize: 12.5, color: COLORS.accent, lineHeight: 18 },
  note: {
    fontFamily: SERIF, fontSize: 12.5, fontStyle: 'italic',
    color: COLORS.inkFaint, lineHeight: 18, marginBottom: 20,
  },
  button: { backgroundColor: COLORS.ink, paddingVertical: 14, alignItems: 'center' },
  buttonText: {
    fontFamily: SANS, fontSize: 14, fontWeight: '600', color: COLORS.sheet,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  secondary: {
    fontFamily: SANS, fontSize: 13, color: COLORS.inkSoft,
    textAlign: 'center', marginTop: 18,
  },
});
