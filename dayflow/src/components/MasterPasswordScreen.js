import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { isMasterPasswordSet, setupMasterPassword, verifyMasterPassword } from '../services/encryption';

export default function MasterPasswordScreen({ onUnlock }) {
  const [isSetup, setIsSetup] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    isMasterPasswordSet().then(set => {
      setIsSetup(!set);
      setLoading(false);
    });
  }, []);

  const handleSetup = async () => {
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    const key = await setupMasterPassword(password);
    onUnlock(key);
  };

  const handleUnlock = async () => {
    setError('');
    const key = await verifyMasterPassword(password);
    if (key) {
      onUnlock(key);
    } else {
      setError('Incorrect password');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <Text style={s.loading}>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={s.inner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.content}>
          <Text style={s.icon}>🔒</Text>
          <Text style={s.title}>{isSetup ? 'Set Up DayFlow' : 'Welcome Back'}</Text>
          <Text style={s.subtitle}>
            {isSetup
              ? 'Create a master password to encrypt your data. This password never leaves your device.'
              : 'Enter your master password to unlock your tasks.'}
          </Text>

          <TextInput
            style={s.input}
            placeholder="Master password"
            placeholderTextColor="#C7C7CC"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            autoFocus
          />

          {isSetup && (
            <TextInput
              style={s.input}
              placeholder="Confirm password"
              placeholderTextColor="#C7C7CC"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
          )}

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[s.btn, !password && s.btnDisabled]}
            onPress={isSetup ? handleSetup : handleUnlock}
            disabled={!password}
          >
            <Text style={s.btnText}>{isSetup ? 'Create & Unlock' : 'Unlock'}</Text>
          </TouchableOpacity>

          {isSetup && (
            <Text style={s.note}>
              Your password encrypts all task data with AES-256 encryption. If you forget it, your data cannot be recovered.
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  inner: { flex: 1, justifyContent: 'center' },
  content: { paddingHorizontal: 32, alignItems: 'center' },
  loading: { textAlign: 'center', marginTop: 100, color: '#8E8E93', fontSize: 16 },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#000', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  input: {
    width: '100%', backgroundColor: '#F5F5F7', borderRadius: 12, padding: 16,
    fontSize: 17, color: '#000', marginBottom: 12,
  },
  error: { color: '#FF3B30', fontSize: 14, marginBottom: 12 },
  btn: {
    width: '100%', backgroundColor: '#007AFF', borderRadius: 12, padding: 16,
    alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  note: { fontSize: 12, color: '#C7C7CC', textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
