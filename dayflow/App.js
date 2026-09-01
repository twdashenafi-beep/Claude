import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { TaskProvider } from './src/context/TaskContext';
import TodoScreen from './src/screens/TodoScreen';
import UnlockScreen from './src/components/UnlockScreen';
import { requestPermissions } from './src/services/notifications';

export default function App() {
  // The encryption key lives in memory only, so closing the app locks it.
  const [vault, setVault] = useState(null);

  useEffect(() => {
    requestPermissions().catch(() => {});
  }, []);

  if (!vault) return <UnlockScreen onUnlock={setVault} />;

  return (
    <TaskProvider encryptionKey={vault.encryptionKey} synced={vault.synced}>
      <StatusBar style="dark" />
      <TodoScreen account={vault.email} onLock={() => setVault(null)} />
    </TaskProvider>
  );
}
