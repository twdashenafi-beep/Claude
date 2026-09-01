// DayFlow API server.
//
// Two jobs, both of which exist so that secrets stay off the device:
//   1. Optional Supabase-backed task endpoints.
//   2. A Claude proxy for the app's AI features — the Anthropic key lives
//      here and is never shipped in the client bundle.
//
// Configure via environment variables (see .env.example). Every capability is
// optional: start the server with no config and it serves /health only.

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const PORT = Number(process.env.PORT) || 3001;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const MODEL = 'claude-opus-5';

// Cost controls.
//
// The AI endpoints spend the operator's money, not the caller's, so an
// unmetered /ai/summary is an open invitation to run up a bill — and the app
// bundle is public, so anyone can find these routes. These are the crude but
// effective limits: a per-caller quota, a global daily ceiling, and a cap on
// how many tasks one request may carry.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_PER_WINDOW = Number(process.env.AI_RATE_LIMIT) || 30;
const DAILY_REQUEST_CEILING = Number(process.env.AI_DAILY_CEILING) || 2000;
const MAX_TASKS_PER_REQUEST = 60;
const MAX_TITLE_LENGTH = 500;

// In-memory, so it resets on restart and does not survive across instances.
// Adequate for one process; a real deployment behind several should move this
// to Redis or the database.
const callers = new Map();
let dailyCount = 0;
let dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;

function rateLimit(req, res, next) {
  const now = Date.now();

  if (now > dailyResetAt) {
    dailyCount = 0;
    dailyResetAt = now + 24 * 60 * 60 * 1000;
  }
  if (dailyCount >= DAILY_REQUEST_CEILING) {
    return res.status(503).json({ error: 'Daily AI limit reached. Try again tomorrow.' });
  }

  // Prefer the authenticated user over the IP: behind a proxy every caller can
  // share an address, and a bearer token is the closer thing to an identity.
  const key = req.get('authorization') || req.ip || 'anonymous';
  const seen = (callers.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);

  if (seen.length >= RATE_MAX_PER_WINDOW) {
    const retryAfter = Math.ceil((RATE_WINDOW_MS - (now - seen[0])) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many AI requests. Try again later.', retryAfter });
  }

  seen.push(now);
  callers.set(key, seen);
  dailyCount += 1;

  // Drop callers that have gone quiet, so the map cannot grow without bound.
  if (callers.size > 5000) {
    for (const [k, times] of callers) {
      if (!times.some(t => now - t < RATE_WINDOW_MS)) callers.delete(k);
    }
  }

  next();
}

// A caller could otherwise post ten thousand tasks and turn one request into a
// very expensive one.
function clampTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.slice(0, MAX_TASKS_PER_REQUEST).map(t => ({
    title: String(t?.title || '').slice(0, MAX_TITLE_LENGTH),
    priority: ['high', 'medium', 'low'].includes(t?.priority) ? t.priority : 'medium',
    completed: !!t?.completed,
  }));
}

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const app = express();
app.use(cors());
// Bounded so a large body cannot be used to exhaust memory before any
// handler sees it.
app.use(express.json({ limit: '256kb' }));

// ── Claude proxy ────────────────────────────────────────────────────────────

// Ask Claude for plain text. `effort: 'low'` keeps short, mechanical prompts
// cheap; max_tokens is generous because adaptive thinking shares the budget.
async function askClaude(prompt, { effort = 'low', maxTokens = 2048 } = {}) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort },
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') return null;

  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();
}

function requireAnthropic(req, res, next) {
  if (!anthropic) {
    return res.status(503).json({
      error: 'AI features are not configured. Set ANTHROPIC_API_KEY on the server.',
    });
  }
  next();
}

function describeTasks(tasks) {
  const safe = clampTasks(tasks);
  if (safe.length === 0) return '(no tasks)';
  return safe
    .map(t => `- ${t.title} [${t.priority}] ${t.completed ? 'done' : 'open'}`)
    .join('\n');
}

app.post('/ai/prioritize', rateLimit, requireAnthropic, async (req, res) => {
  const { title, context } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const safeTitle = title.trim().slice(0, MAX_TITLE_LENGTH);
  try {
    const text = await askClaude(
      `Suggest a priority for a new task in a personal task manager.\n\n` +
        `New task: "${safeTitle}"\n` +
        `Existing tasks:\n${describeTasks(context)}\n\n` +
        `Reply with exactly one word: high, medium, or low.`
    );
    res.json({ text });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/ai/steps', rateLimit, requireAnthropic, async (req, res) => {
  const { title } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const safeTitle = title.trim().slice(0, MAX_TITLE_LENGTH);
  try {
    const text = await askClaude(
      `Break this task into 3-5 actionable sub-steps, one concise line each.\n\n` +
        `Task: "${safeTitle}"\n\n` +
        `Reply with just the numbered steps, nothing else.`,
      { effort: 'low', maxTokens: 4096 }
    );
    res.json({ text });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/ai/summary', rateLimit, requireAnthropic, async (req, res) => {
  const { tasks, period } = req.body || {};
  const window = period === 'week' ? 'weekly' : 'daily';
  try {
    const text = await askClaude(
      `Write a brief 2-3 sentence ${window} summary of this task list. ` +
        `Say what to focus on, and call out anything high priority.\n\n` +
        `Tasks:\n${describeTasks(tasks)}`,
      { effort: 'low', maxTokens: 4096 }
    );
    res.json({ text });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// ── Supabase-backed tasks (optional) ────────────────────────────────────────

function requireSupabase(req, res, next) {
  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.',
    });
  }
  next();
}

app.post('/task', requireSupabase, async (req, res) => {
  try {
    const { title, priority } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }

    const taskRow = {
      title: title.trim(),
      priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
      completed: false,
    };

    const { data, error } = await supabase.from('tasks').insert(taskRow).select().single();

    if (error) {
      // Row Level Security blocks anonymous writes by design — the schema in
      // supabase/schema.sql scopes every row to auth.uid().
      if (error.code === '42501' || error.message.includes('policy')) {
        return res.status(403).json({
          success: false,
          error:
            'Row Level Security blocked this insert. Sign the request in as a Supabase user, ' +
            'or relax the policies in supabase/schema.sql for local testing.',
        });
      }
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, task: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/tasks', requireSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('date', { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, tasks: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    port: PORT,
    ai: !!anthropic,
    supabase: !!supabase,
    aiRequestsToday: dailyCount,
    aiDailyCeiling: DAILY_REQUEST_CEILING,
  });
});

app.listen(PORT, () => {
  console.log(`DayFlow API running on http://localhost:${PORT}`);
  console.log(`  AI features:  ${anthropic ? 'enabled' : 'disabled (set ANTHROPIC_API_KEY)'}`);
  console.log(`  Supabase:     ${supabase ? 'enabled' : 'disabled (set SUPABASE_URL / SUPABASE_ANON_KEY)'}`);
  if (anthropic) {
    console.log(`  AI limits:    ${RATE_MAX_PER_WINDOW}/caller/hour, ${DAILY_REQUEST_CEILING}/day total`);
  }
});
