---
name: support
description: Triage a DayFlow support message and draft a reply. Use when a user reports a fault, asks how something works, or sends a screenshot of the Account sheet. Maps a symptom to its cause using the diagnoses this app has already paid for, and drafts a reply for a person to send.
---

# Answering a DayFlow support message

The reply is **drafted, not sent**. One person's name is on this app and the
answers go out under it.

## Before writing anything

Ask for the two screenshots the support page asks for — the **Calendar link**
row and the **build line** at the bottom of Account — unless the message already
makes the answer certain. Nearly every fault in this app's history was decided
by one of those two lines, and three days went into one that was answered by a
screenshot the moment it arrived.

**Establish which copy they are running before diagnosing anything.** "Installed
app · 1.0.0 (47)" and the web page behave differently, and a fault that cannot
exist in their build is not their fault. If the build predates the fix you are
about to describe, say so and stop.

## What has actually gone wrong before

Work down this list before inventing a new explanation. Each one looked like
something else first.

| What they say | What it has been |
| --- | --- |
| "The day bar has disappeared" | No calendar on that device. The link is kept on the device that pasted it: it does not sync and is not in an exported copy, so a reinstall or a restore loses it while every task comes back. |
| "I linked it and it is still not back" | Read the Calendar link row. "none coming up" means it parsed and holds nothing in the next three weeks — usually the wrong calendar, since a service gives one link per calendar. The rest of the line says which kind of nothing. |
| "Voice notes record but will not play" | Was the recording's format being lost on the way into storage, so the file was written with an extension iOS refuses. Fixed in build 44. On an older build, that is the cause. A note recorded in a browser cannot play on an iPhone at all — no iPhone decodes webm — and the row says so. |
| "Tasks are in the wrong order" | A task with a time is placed by its time and cannot be dragged. The Order buttons in the task sheet are off and say why. Clearing the time hands it back. |
| "I lost my password" | Nothing can be done, by anyone. Say it plainly and early. The recovery code is the only other way in. If both are gone, their tasks are gone — and an exported copy is the only thing that would have helped. |
| "Export says it is too large" | A build before 43. Updating fixes it; the phone writes a real file now. |

## Diagnosing something new

The app knows more than it used to and most of it is on screen:

- **Account → Calendar link** — name, entries, how many are coming up, and when
  none are, why none.
- **Account → This device** — storage, dictation, sound, and what the phone's
  own calendar last reported, including the iOS Settings path when permission
  is the problem.
- **Account → Encryption** — pulls their own rows back from the server and
  reads them as an intruder would.
- The **build line** at the bottom.

Ask for the line, not for a description of it. A quoted line is a fact; a
paraphrase is a guess, and this app has lost days to paraphrases.

## Rules for the reply

- **Say what is true, including when it is bad.** "Nobody can recover that" is
  a better answer than a hopeful one. The app is built on that promise and the
  support reply is where it is tested.
- **Never ask for a password or recovery code**, and say in the reply that
  nobody should ever ask for them.
- **Name the build a fix is in**, so they can tell whether updating helps.
- **One screenshot beats four questions.** Ask for it once, early.
- If it is a real fault, say so without flannel, say whether there is a way
  round it today, and do not promise a date.
- Keep it short. These are read on a phone.

## What not to do here

- Do not send anything. Draft it and hand it over.
- Do not offer refunds, discounts or anything that costs money — that is the
  owner's call, and Apple handles App Store refunds under its own policy.
- Do not speculate about a cause in the reply. Narrow it with a question
  instead; a wrong confident answer costs more than a short one.
- Do not change code from a support message alone. Reproduce it first, or ask
  for what would let you.
