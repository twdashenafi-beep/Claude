# DayFlow

A local-first day planner built around two columns: **To Do** (what you owe the
day) and **Owe Me** (what the day owes you). Type tasks in plain language —
`Call Mekdi at 7pm today` — and DayFlow works out the title, date, time,
priority and column. Claude can read and write the same board through the
bundled **MCP server**.

```
 Browser UI ─┐
             ├─→  DayFlow server (:3001)  ─→  ~/.dayflow/tasks.json
 Claude ─ MCP ┘         REST + SSE
```

No build step, no framework, no external services. Two files of dependencies —
and only for the MCP server.

## Run it

```bash
cd dayflow
npm start                 # → http://127.0.0.1:3001
```

That one process serves the UI, the API and the live-update stream. Tasks are
stored in `~/.dayflow/tasks.json` (override with `DAYFLOW_DATA`).

| Env var | Default | Meaning |
|---------|---------|---------|
| `DAYFLOW_PORT` | `3001` | Port to listen on |
| `DAYFLOW_HOST` | `127.0.0.1` | Interface to bind |
| `DAYFLOW_DATA` | `~/.dayflow/tasks.json` | Where tasks are stored |

## Natural-language capture

The parser (`lib/parse.js`) is rule-based and deterministic — no API key, no
network call. It understands:

| You type | You get |
|----------|---------|
| `Call Mekdi at 7pm today` | today, 19:00 |
| `remind me to pay rent tomorrow, urgent` | "Pay rent tomorrow", tomorrow, **high** |
| `Abel owes me $20 by friday` | **Owe Me**, Abel, $20, Friday |
| `standup 9:30am monday` | next Monday, 09:30 |
| `file taxes on Dec 5` · `dentist 12/5` · `review 2026-10-01` | that date |
| `review PR in 3 days` · `ship it end of week` · `budget next month` | relative dates, scoped to week/month |
| `groceries in the morning` · `drinks tonight` | 09:00 · 20:00 |
| `sort the garage, low priority` · `submit invoice !!` | **low** · **high** |
| `submit report notes: include Q3 numbers` | notes split off the title |

A few deliberate conventions: a bare hour leans the way people mean it (`gym at
6` → 18:00, `flight at 9` → 09:00); a task with a time but no date is **today**;
`next friday` skips today if today is Friday; and a month/day already past rolls
to next year. The capture box previews the parse before you commit it.

## Using the board

- **Day / Week / Month** switch the period; `←` `→` step, `t` jumps to today.
- Open work from before today keeps surfacing on today's board, flagged
  **overdue**, until you deal with it.
- Click a task title (or ✎) to edit date, time, priority, column, debtor,
  amount and notes inline.
- Deleting shows an **Undo**. Completed tasks collapse into their own section.
- `/` focuses search, `n` focuses capture, `Esc` cancels.
- The theme button cycles auto → light → dark.

Anything Claude changes appears immediately — the server pushes a
Server-Sent Event and the page reloads the board.

## Connect Claude (MCP)

```bash
cd dayflow/mcp && npm install
```

Then register the server. **Claude Code:**

```bash
claude mcp add dayflow -- node /absolute/path/to/dayflow/mcp/index.js
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dayflow": {
      "command": "node",
      "args": ["/absolute/path/to/dayflow/mcp/index.js"],
      "env": { "DAYFLOW_PORT": "3001" }
    }
  }
}
```

`mcp/mcp.example.json` has the same snippet ready to copy. Six tools are
exposed: `dayflow_create_task`, `dayflow_get_tasks`, `dayflow_complete_task`,
`dayflow_update_task`, `dayflow_delete_task`, `dayflow_search_tasks`. Tasks
Claude creates are tagged `claude` on the board.

Keep `npm start` running — the MCP server is a thin client over the same HTTP
API and reports "DayFlow not reachable" if the app is closed.

## API

Everything is JSON. Errors come back as `{ "success": false, "error": "…" }`
with a 4xx status.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/tasks` | Filters: `status=open\|completed`, `section=todo\|owe_me`, `q=`, `view=`, `date=`, `from=`, `to=` |
| `GET` | `/task?id=` | A single task |
| `GET` | `/parse?text=` | Dry-run the parser, creates nothing |
| `POST` | `/add-task` | `{text}` to parse, or `{title, due_date, due_time, priority, category, view, owed_by, owed_amount, notes}` |
| `POST` | `/complete-task` | `{id, completed?}` — omit `completed` to mark done |
| `POST` | `/update-task` | `{id, …fields}`; `null` clears a field |
| `POST` | `/delete-task` | `{id}` |
| `POST` | `/clear-completed` | `{section?}` |
| `GET` | `/events` | SSE stream of `change` events |
| `GET` | `/health` | Task counts and the data file in use |

Field names are accepted in both `snake_case` and `camelCase`.

## Your data stays on your machine

Tasks are personal, so the server takes the matching precautions: it binds to
loopback only, sends no CORS headers, and rejects requests whose `Host` header
isn't localhost (the DNS-rebinding trick a malicious page would use to reach
`127.0.0.1:3001`). Request bodies are capped, static paths can't escape
`public/`, and writes go through a temp file + rename so a crash can't truncate
your task file — an unreadable file is set aside rather than silently replaced
with an empty board.

## Tests

```bash
npm test      # 36 tests: parser, store, API, security, SSE
```

## Layout

```
dayflow/
├── server.js          HTTP API, static hosting, SSE, validation
├── lib/parse.js       natural-language → task fields
├── lib/store.js       JSON persistence, filtering, sorting
├── public/            the UI (index.html, app.js, app.css)
├── mcp/index.js       MCP server — the bridge to Claude
└── test/              parser + API/store/security tests
```
