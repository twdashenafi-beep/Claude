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

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const app = express();
app.use(cors());
app.use(express.json());

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
  if (!Array.isArray(tasks) || tasks.length === 0) return '(no tasks)';
  return tasks
    .map(t => `- ${t.title} [${t.priority || 'medium'}] ${t.completed ? 'done' : 'open'}`)
    .join('\n');
}

app.post('/ai/prioritize', requireAnthropic, async (req, res) => {
  const { title, context } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const text = await askClaude(
      `Suggest a priority for a new task in a personal task manager.\n\n` +
        `New task: "${title.trim()}"\n` +
        `Existing tasks:\n${describeTasks(context)}\n\n` +
        `Reply with exactly one word: high, medium, or low.`
    );
    res.json({ text });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/ai/steps', requireAnthropic, async (req, res) => {
  const { title } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const text = await askClaude(
      `Break this task into 3-5 actionable sub-steps, one concise line each.\n\n` +
        `Task: "${title.trim()}"\n\n` +
        `Reply with just the numbered steps, nothing else.`,
      { effort: 'low', maxTokens: 4096 }
    );
    res.json({ text });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/ai/summary', requireAnthropic, async (req, res) => {
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
  });
});

app.listen(PORT, () => {
  console.log(`DayFlow API running on http://localhost:${PORT}`);
  console.log(`  AI features:  ${anthropic ? 'enabled' : 'disabled (set ANTHROPIC_API_KEY)'}`);
  console.log(`  Supabase:     ${supabase ? 'enabled' : 'disabled (set SUPABASE_URL / SUPABASE_ANON_KEY)'}`);
});
