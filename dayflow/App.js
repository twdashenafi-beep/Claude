import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { TaskProvider } from './src/context/TaskContext';
import TodoScreen from './src/screens/TodoScreen';
import UnlockScreen from './src/components/UnlockScreen';
import ErrorBoundary, { recordError } from './src/components/ErrorBoundary';
import { requestPermissions } from './src/services/notifications';

export default function App() {
  // The encryption key lives in memory only, so closing the app locks it.
  const [vault, setVault] = useState(null);

  useEffect(() => {
    requestPermissions().catch(() => {});

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
      {!vault ? (
        <UnlockScreen onUnlock={setVault} />
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
