// The optional Claude summary in the daily briefing.
//
// This is the app's whole model surface, and deliberately its whole model
// surface. Everything else — parsing what you typed, deciding what is late,
// working out how long something has been sitting — is local, instant and
// works with the aeroplane mode on, which is the behaviour worth protecting.
//
// It is also the one place that sends task titles off the device in the clear,
// which is why it is off unless somebody turns it on: the rest of the app
// promises the server sees only ciphertext.
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

export async function getDailySummary(tasks) {
  return askServer('/ai/summary', {
    tasks: tasks.map(t => ({ title: t.title, priority: t.priority, completed: t.completed })),
  });
}
