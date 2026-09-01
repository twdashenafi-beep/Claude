import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scheduleTaskNotifications, cancelTaskNotifications } from '../services/notifications';
import { newId } from '../utils/id';
import { encryptTask, decryptTask } from '../services/encryption';

const TaskContext = createContext();
const STORAGE_KEY = '@dayflow_tasks_encrypted';

export function TaskProvider({ children, encryptionKey }) {
  const [tasks, setTasks] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Load and decrypt tasks on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const raw = JSON.parse(stored);
          const decrypted = raw.map(t => decryptTask(t, encryptionKey));
          setTasks(decrypted);
        }
      } catch (e) {
        console.log('Failed to load tasks:', e);
      }
      setLoaded(true);
    })();
  }, [encryptionKey]);

  // Encrypt and persist tasks on change
  useEffect(() => {
    if (!loaded) return;
    const encrypted = tasks.map(t => encryptTask(t, encryptionKey));
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted)).catch(() => {});
  }, [tasks, loaded, encryptionKey]);

  const addTask = useCallback((taskData) => {
    const newTask = {
      id: newId(),
      title: taskData.title,
      date: taskData.date || new Date().toISOString(),
      dueDate: taskData.dueDate || taskData.date || new Date().toISOString(),
      dueTime: taskData.dueTime || '',
      reminderEnabled: taskData.reminderEnabled || false,
      earlyReminderMinutes: taskData.earlyReminderMinutes || 0,
      reminderDate: taskData.reminderDate || null,
      reminderTime: taskData.reminderTime || null,
      priority: taskData.priority || 'medium',
      completed: false,
      section: taskData.section || 'todo',
      taskType: taskData.taskType || 'todo',
      viewScope: taskData.viewScope || 'day',
      owePerson: taskData.owePerson || '',
      oweAmount: taskData.oweAmount || '',
      oweCurrency: taskData.oweCurrency || 'USD',
      owePaid: false,
      notes: taskData.notes || '',
      voiceNoteUri: taskData.voiceNoteUri || null,
      attachments: taskData.attachments || [],
      createdAt: new Date().toISOString(),
    };
    setTasks(prev => [newTask, ...prev]);

    if (newTask.dueDate && newTask.dueTime) {
      scheduleTaskNotifications(newTask).catch(() => {});
    }
    return newTask;
  }, []);

  const toggleTask = useCallback((id) => {
    setTasks(prev =>
      prev.map(t => {
        if (t.id !== id) return t;
        const updated = { ...t, completed: !t.completed };
        if (updated.completed) cancelTaskNotifications(id);
        else if (updated.dueDate && updated.dueTime) scheduleTaskNotifications(updated).catch(() => {});
        return updated;
      })
    );
  }, []);

  const deleteTask = useCallback((id) => {
    cancelTaskNotifications(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateTask = useCallback((id, updates) => {
    setTasks(prev =>
      prev.map(t => {
        if (t.id !== id) return t;
        const updated = { ...t, ...updates };
        if (!updated.completed && updated.dueDate && updated.dueTime) scheduleTaskNotifications(updated).catch(() => {});
        else cancelTaskNotifications(id);
        return updated;
      })
    );
  }, []);

  return (
    <TaskContext.Provider value={{ tasks, addTask, toggleTask, deleteTask, updateTask }}>
      {children}
    </TaskContext.Provider>
  );
}

export function useTasks() {
  const context = useContext(TaskContext);
  if (!context) throw new Error('useTasks must be used within TaskProvider');
  return context;
}
