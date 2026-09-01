// Optional AI task intelligence.
//
// The client NEVER holds an Anthropic API key. Anything shipped in an app
// bundle — web, iOS or Android — is readable by anyone who installs it, so all
// Claude calls go through the DayFlow API server (see api-server.js), which
// holds the key server-side.
//
// Set EXPO_PUBLIC_API_URL to point at that server. If it is unset, every
// function here resolves to null and the app falls back to its local,
// offline behaviour.

const API_URL = process.env.EXPO_PUBLIC_API_URL || '';

export const isAIConfigured = !!API_URL;

async function askServer(endpoint, body) {
  if (!API_URL) return null;
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const data = await response.json();
    return data.text ?? null;
  } catch (error) {
    console.warn('AI request error:', error.message);
    return null;
  }
}

export async function autoPrioritize(taskTitle, existingTasks = []) {
  const context = existingTasks.slice(0, 10).map(t => ({ title: t.title, priority: t.priority }));
  const result = await askServer('/ai/prioritize', { title: taskTitle, context });
  const lower = (result || '').toLowerCase().trim();
  return ['high', 'medium', 'low'].includes(lower) ? lower : 'medium';
}

export async function breakIntoSteps(taskTitle) {
  const result = await askServer('/ai/steps', { title: taskTitle });
  if (!result) return [];
  return result
    .split('\n')
    .filter(line => line.trim())
    .map(line => line.replace(/^\d+[.)]\s*/, '').trim());
}

export async function getDailySummary(tasks) {
  return askServer('/ai/summary', {
    period: 'day',
    tasks: tasks.map(t => ({ title: t.title, priority: t.priority, completed: t.completed })),
  });
}

export async function getWeeklySummary(tasks) {
  return askServer('/ai/summary', {
    period: 'week',
    tasks: tasks.slice(0, 15).map(t => ({ title: t.title, priority: t.priority, completed: t.completed })),
  });
}
