import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../lib/parse.js";

// A fixed "now" — Sunday 20 September 2026, 09:00 local.
const NOW = new Date(2026, 8, 20, 9, 0, 0);
const p = (text) => parse(text, NOW);

test("pulls out time, keeps the day word in the title", () => {
  const t = p("Call Mekdi at 7pm today");
  assert.equal(t.title, "Call Mekdi today");
  assert.equal(t.dueTime, "19:00");
  assert.equal(t.dueDate, "2026-09-20");
  assert.equal(t.section, "todo");
  assert.equal(t.priority, "medium");
});

test("strips reminder filler and reads priority words", () => {
  const t = p("remind me to pay rent tomorrow, urgent");
  assert.equal(t.title, "Pay rent tomorrow");
  assert.equal(t.dueDate, "2026-09-21");
  assert.equal(t.priority, "high");
});

test("'!!' marks high priority", () => {
  assert.equal(p("submit invoice !!").priority, "high");
});

test("low-priority phrasing", () => {
  assert.equal(p("sort the garage, low priority").priority, "low");
  assert.equal(p("read that book someday").priority, "low");
});

test("routes debts to Owe Me with debtor and amount", () => {
  const t = p("Abel owes me $20 by friday");
  assert.equal(t.section, "owe_me");
  assert.equal(t.owedBy, "Abel");
  assert.equal(t.owedAmount, "$20");
  assert.equal(t.dueDate, "2026-09-25");
});

test("'I lent X' is also Owe Me", () => {
  const t = p("I lent Sara 500 birr");
  assert.equal(t.section, "owe_me");
  assert.equal(t.owedBy, "Sara");
  assert.equal(t.owedAmount, "500 birr");
});

test("24h and 12h times", () => {
  assert.equal(p("meeting at 14:30").dueTime, "14:30");
  assert.equal(p("standup 9:30am").dueTime, "09:30");
  assert.equal(p("call at 12am").dueTime, "00:00");
  assert.equal(p("call at 12pm").dueTime, "12:00");
  assert.equal(p("lunch at noon").dueTime, "12:00");
  assert.equal(p("deploy at midnight").dueTime, "00:00");
});

test("a bare hour leans the way people mean it", () => {
  assert.equal(p("gym at 6").dueTime, "18:00");
  assert.equal(p("flight at 9").dueTime, "09:00");
  assert.equal(p("report by 5").dueTime, "17:00");
});

test("part of day when no clock time is given", () => {
  assert.equal(p("groceries in the morning").dueTime, "09:00");
  assert.equal(p("call Dad this evening").dueTime, "18:00");
  assert.equal(p("drinks tonight").dueTime, "20:00");
});

test("weekday names resolve forward", () => {
  assert.equal(p("gym monday").dueDate, "2026-09-21");
  assert.equal(p("gym sunday").dueDate, "2026-09-20", "today counts as this Sunday");
  assert.equal(p("gym next sunday").dueDate, "2026-09-27", "'next' skips today");
});

test("month-name and numeric dates", () => {
  assert.equal(p("file taxes on Dec 5").dueDate, "2026-12-05");
  assert.equal(p("party 25th of december").dueDate, "2026-12-25");
  assert.equal(p("dentist 12/5 at 3pm").dueDate, "2026-12-05");
  assert.equal(p("pay back 3/15/27").dueDate, "2027-03-15");
  assert.equal(p("review 2026-10-01").dueDate, "2026-10-01");
});

test("a month/day already past rolls to next year", () => {
  assert.equal(p("renew licence on Jan 4").dueDate, "2027-01-04");
});

test("nonsense dates are ignored rather than invented", () => {
  const t = p("something on Feb 31");
  assert.equal(t.dueDate, "2026-09-20", "falls back to today");
});

test("relative and scoped horizons", () => {
  assert.equal(p("review PR in 3 days").dueDate, "2026-09-23");
  assert.deepEqual(
    { d: p("pay in 2 weeks").dueDate, v: p("pay in 2 weeks").view },
    { d: "2026-10-04", v: "week" });
  assert.equal(p("plan offsite next week").dueDate, "2026-09-21");
  assert.equal(p("plan offsite next week").view, "week");
  assert.equal(p("budget next month").dueDate, "2026-10-01");
  assert.equal(p("budget next month").view, "month");
  assert.equal(p("ship it end of week").dueDate, "2026-09-25");
  assert.equal(p("close books end of month").dueDate, "2026-09-30");
  assert.equal(p("groceries this week").view, "week");
});

test("notes split off after an explicit marker", () => {
  assert.equal(p("review PR in 3 days -- check the migration").notes, "check the migration");
  const t = p("submit report end of week notes: include Q3 numbers");
  assert.equal(t.title, "Submit report");
  assert.equal(t.notes, "include Q3 numbers");
});

test("a plain task defaults to today, medium, To Do", () => {
  const t = p("buy milk");
  assert.deepEqual(
    [t.title, t.dueDate, t.dueTime, t.priority, t.section, t.view],
    ["Buy milk", "2026-09-20", null, "medium", "todo", "day"]);
});

test("empty input never produces an empty title", () => {
  assert.equal(p("   ").title, "Untitled task");
  assert.equal(p("at").title, "At");
});
