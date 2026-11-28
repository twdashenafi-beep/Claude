# The agent inbox

Other programs can propose tasks to DayFlow. Nothing they propose reaches your
task list until you accept it.

Proposals are collected by the **Mac app only**, through a folder in your own
Google Drive that Google Drive for desktop keeps on the Mac. DayFlow does not
sign in to Google, and there is no key or password anywhere in this.

With sync on, the Mac passes what it collects to your other devices, so a
phone shows the same **Suggested** list and can accept or dismiss from it. See
[On your other devices](#on-your-other-devices).

```
DayFlow/
  agent-inbox/            agents write .json files here
    processed/            files DayFlow has read
    rejected/             files it refused, each with a .reason.txt beside it
  export/
    dayflow-export.json   your tasks, if you switch the export on
```

## Setting it up

1. Install Google Drive for desktop and sign in.
2. Open the DayFlow Mac app. With one Google account it finds
   `My Drive/DayFlow` by itself and creates the folders. With more than one, or
   to use a different folder: **File › Choose Agent Inbox Folder…**
3. Open **Projects**. A **Suggested** tab appears: first in the row when
   something is waiting, and beside Finished when nothing is.

DayFlow checks the inbox when it opens and every 15 minutes while it is open.
**Check now** on the Suggested page checks at once.

## What an agent writes

One proposal, a list of them, or `{ "proposals": [...] }`, in a `.json` file of
at most 256 KB and at most 100 proposals.

```json
{
  "type": "new_task",
  "id": "deal-42-call",
  "title": "Call the refinery about Q1 volumes",
  "notes": "Ask about the Djibouti slot.",
  "due": "2026-12-03",
  "owner": "me",
  "deal": "Djibouti diesel",
  "agent": "deal-bot",
  "source_url": "https://example.com/thread/42"
}
```

| Field | Rule |
| --- | --- |
| `type` | `new_task` or `status_suggestion`. Required. |
| `id` | Required. Letters, digits and `. _ : -`, up to 120. Unique per agent: the same `agent` and `id` again is ignored. |
| `agent`, `deal` | Required. Up to 60 and 120 characters. |
| `owner` | Required. `me` makes a To Do. Any other name makes an Owe Me task, with that person as the one who owes it. |
| `title` | Required for `new_task`. Up to 200 characters. |
| `notes` | Optional. Up to 4,000 characters. |
| `due` | Optional. A real date, `YYYY-MM-DD`. |
| `source_url` | Optional. Must start `https://`. |

A status suggestion asks you to mark a task done, or not done:

```json
{
  "type": "status_suggestion",
  "id": "deal-42-call-done",
  "agent": "deal-bot",
  "deal": "Djibouti diesel",
  "owner": "me",
  "target_task_id": "deal-42-call",
  "suggested_status": "done",
  "evidence": "Email from the refinery on 25 Nov confirms the call happened."
}
```

`target_task_id` is the `id` of a `new_task` **the same agent** proposed and you
accepted. `suggested_status` is `done` or `open`. `evidence` is required.

If anything in a file is wrong, the whole file goes to `rejected/` and nothing
in it is used. The `.reason.txt` beside it says which proposal and why.

## What an agent cannot do

- Put anything on your page. A proposal waits under Suggested until you tap.
- Delete a task, edit one, or finish one. A status suggestion only shows up as
  a suggestion, with its evidence.
- Touch a task you made yourself, or another agent's task.

Text from a file is shown as plain text. The only link is the source link, and
only if it is `https`.

**Agent names are not checked.** Anyone, or anything, that can write to the
folder can use any agent name. Your tap is the safeguard, so read before you
accept — and share the folder only with what you trust to write to it.

Dismissed proposals are kept (Suggested › decided) and are not offered again.

## On your other devices

The Mac is the only device that can read the folder, so it is the only one that
learns of a proposal first-hand. With sync on, it shares each one with your
other devices:

- Each suggestion is one row in its own table, `agent_suggestions`, encrypted
  with the same key as your tasks. The row's id is an HMAC under that key, so
  the server cannot read the title, the agent's name, or anything else.
- A decision on one device is the decision on all of them. If two devices
  disagree, a decision beats waiting, and the earlier of two decisions stands.
- Accepting on two devices at once makes one task, not two.
- A device re-checks every suggestion it receives, field by field, as the Mac
  checked the file.
- The Mac has to run for a new proposal to be collected. A proposal written
  while the Mac app is closed reaches a phone after the Mac next opens.

**The table has to be added once.** A sync database set up before this feature
does not have it. Run `supabase/schema.sql` again in the Supabase SQL editor;
it is safe to re-run. Until then everything works as before, proposals stay on
the Mac, and the Suggested page says so.

The switch to write tasks to Google Drive is on the Mac only.

## The export

Off by default. **Suggested › Write my tasks to Google Drive** turns it on.

While it is on, every change to your tasks rewrites
`DayFlow/export/dayflow-export.json` with your whole task list and every
proposal's status: `suggested`, `accepted`, `dismissed` or `completed`. Voice
notes are left out.

**The file is not encrypted**, and everyone and everything with access to the
folder can read it. This is the one place DayFlow writes your tasks somewhere
readable on its own, which is why it is a switch.

It is a separate file in its own format (`"format": "dayflow-agent-export"`).
**Account › Export a copy**, the backup you restore from, is unchanged.
