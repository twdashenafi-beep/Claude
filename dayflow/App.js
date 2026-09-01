import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { TaskProvider } from './src/context/TaskContext';
import TodoScreen from './src/screens/TodoScreen';
import MasterPasswordScreen from './src/components/MasterPasswordScreen';
import { requestPermissions } from './src/services/notifications';

export default function App() {
  const [encryptionKey, setEncryptionKey] = useState(null);

  useEffect(() => {
    requestPermissions().catch(() => {});
  }, []);

  if (!encryptionKey) {
    return <MasterPasswordScreen onUnlock={setEncryptionKey} />;
  }

  return (
    <TaskProvider encryptionKey={encryptionKey}>
      <StatusBar style="dark" />
      <TodoScreen />
    </TaskProvider>
  );
}
