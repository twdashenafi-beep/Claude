import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { TaskProvider } from './src/context/TaskContext';
import TodoScreen from './src/screens/TodoScreen';
import UnlockScreen from './src/components/UnlockScreen';
import SyncSetup from './src/components/SyncSetup';
import ErrorBoundary, { recordError } from './src/components/ErrorBoundary';
import { requestPermissions } from './src/services/notifications';
import { initSync } from './src/services/supabase';
import { markSyncSkipped, wasSyncSkipped } from './src/services/syncConfig';
import { unlockChime } from './src/services/chime';
import { hasSecureRandom, RANDOM_SOURCE } from './src/services/secureRandom';

export default function App() {
  // The encryption key lives in memory only, so closing the app locks it.
  const [vault, setVault] = useState(null);

  // Sync details are read from storage before anything can sign in, so nothing
  // renders until that has settled — otherwise the unlock screen would briefly
  // claim to be offline on a device that is in fact connected.
  const [syncChecked, setSyncChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    initSync()
      .then(async configured => {
        if (!configured) setNeedsSetup(!(await wasSyncSkipped()));
      })
      .catch(() => {})
      .finally(() => setSyncChecked(true));
  }, []);

  useEffect(() => {
    requestPermissions().catch(() => {});

    // Browsers refuse to start audio until the page has been interacted with,
    // so the reminder sound is armed by the first tap or keypress rather than
    // at launch, where it would be refused and stay refused.
    if (typeof window !== 'undefined' && window.addEventListener) {
      const arm = () => {
        unlockChime();
        window.removeEventListener('pointerdown', arm);
        window.removeEventListener('keydown', arm);
      };
      window.addEventListener('pointerdown', arm);
      window.addEventListener('keydown', arm);
    }

    // An error boundary only catches render and lifecycle errors. Rejected
    // promises escape it entirely, and on web they would otherwise reach the
    // console and nowhere else.
    if (typeof window === 'undefined' || !window.addEventListener) return undefined;
    const onRejection = event => recordError(event.reason || new Error('Unhandled rejection'));
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  // Nothing this app does is safe without real randomness: the data key, the
  // recovery code and every AES salt come from it. If the platform has none and
  // the polyfill could not install one, the honest thing is to stop at the door
  // rather than let the user create an account whose encryption is not there.
  if (!hasSecureRandom()) {
    return (
      <View style={fatal.wrap}>
        <Text style={fatal.title}>DayFlow cannot start safely</Text>
        <Text style={fatal.body}>
          This device provides no secure source of randomness, which DayFlow needs
          to generate the key that encrypts your tasks. Rather than store anything
          it cannot protect, it has stopped.
        </Text>
        <Text style={fatal.detail}>Randomness source: {RANDOM_SOURCE}</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary onReset={() => setVault(null)}>
      {!syncChecked ? null : needsSetup ? (
        <SyncSetup
          onDone={() => setNeedsSetup(false)}
          onSkip={() => { markSyncSkipped().catch(() => {}); setNeedsSetup(false); }}
        />
      ) : !vault ? (
        <UnlockScreen onUnlock={setVault} onSetupSync={() => setNeedsSetup(true)} />
      ) : (
        <TaskProvider encryptionKey={vault.dataKey} synced={vault.synced}>
          <StatusBar style="dark" />
          <TodoScreen
            account={vault.email}
            dataKey={vault.dataKey}
            onLock={() => setVault(null)}
            onDeleted={() => setVault(null)}
          />
        </TaskProvider>
      )}
    </ErrorBoundary>
  );
}

const fatal = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 32, backgroundColor: '#E9E6DF' },
  title: { fontSize: 20, fontWeight: '700', color: '#1A1A18', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, color: '#57534B' },
  detail: { fontSize: 12, color: '#96907F', marginTop: 16 },
});
