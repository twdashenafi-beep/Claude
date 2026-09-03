import React, { useState, useEffect } from 'react';
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
