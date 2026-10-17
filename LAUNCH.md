# Taking DayFlow to market

Written in the order it has to happen. The first section is the one that
decides whether the rest is worth doing.

---

## 0. The thing that is not done

Three testers have had the app for a fortnight and said nothing. That is the
only evidence of demand there is, and it is not evidence of demand.

Nothing below is worth starting until the web version has been in front of
30–50 people and some of them are still using it in week two. The link is live,
costs nothing, needs no Apple account and no payment setup:

    https://twdashenafi-beep.github.io/Claude/about.html

If that number comes back near zero, the right answer is to keep DayFlow as the
tool it already is — one that works very well for one person — and spend the
months on the remittance business instead.

---

## 1. Company, or not

**You may not need one.** Apple pays individuals. An individual Developer
account can sell an app, and a sole trader can take the money. A limited company
adds a filing obligation, an accountant and an annual cost, for liability
protection a task list barely needs.

**The one decision that is hard to undo** is the seller name on the App Store,
because that is what a buyer sees and what appears on their receipt. Changing an
individual account into an organisation one later means a D-U-N-S number and
moving the app between accounts, which is a real piece of work. So decide before
the first listing, not after.

- *Selling as yourself* — "Tewodros Ashenafi". Nothing to set up. Fine for a
  £10 app; honest, and plenty of respected indie software is sold this way.
- *Selling as a company* — "DayFlow Ltd" or similar. Needed if you ever want to
  sell the app itself, take investment, or keep it at arm's length from you.

If a company: a UK private company limited by shares is £50 online at Companies
House and takes a day. You need a name, a registered office address that is
allowed to be public, at least one director (you), one share, and a SIC code
(62012, business and domestic software development). Then a business bank
account, and register for Corporation Tax within three months of starting to
trade.

**This cannot be done from here.** It needs your identity documents, an address
and a payment.

**Worth one conversation with the counsel already engaged on AbayLink**, rather
than deciding twice: whether this sits in the UK at all, given what is being
built in the UAE. It is a small question attached to a much larger structure.

---

## 2. Getting paid

Apple, for the app:

1. App Store Connect → **Agreements, Tax and Banking**. Accept the Paid
   Applications agreement — the app cannot be sold until it is active.
2. Bank account and tax forms. **W-8BEN** (or W-8BEN-E for a company) if you are
   outside the US, or Apple withholds US tax.
3. Apply to the **Small Business Program**. It takes Apple's share from 30% to
   15% below $1m a year and it is *not* automatic — it is an application, and
   the year it is missed is money gone.
4. Payouts are monthly, roughly 30–45 days after the month closes, above a
   minimum threshold.

For the web version, if it is ever sold directly: use **Paddle** rather than
Stripe. Paddle is a merchant of record, so it handles VAT in every jurisdiction
it sells into. Stripe leaves that to you, and VAT on digital goods sold
internationally is a serious administrative burden for one person.

Do not link out of the iOS app to a web purchase. Apple requires in-app purchase
for digital goods, and the exceptions are narrow and jurisdictional.

---

## 3. Pricing

Free to download, one-off unlock. The app works alone on one device with no
account; the unlock covers sync, backup and restore, and voice notes.

**£9.99–12.99.** That is the band where a considered tool by one person sits —
Things is £9.99, Due is £7.99 — and it suits an app with no running cost per
user, because sync is a database the user owns.

No subscription. There is nothing recurring to charge for, and the listing
already says "no subscription" as a selling point.

---

## 4. What to say

The positioning is settled and the listing already carries it:

> **Two lists, side by side.** What you owe, and what you are owed.

The line to lead with anywhere else:

> The work that actually slips is rarely something you forgot to do. It is
> something somebody else has, and you have lost track of how long they have
> had it.

Everything else about the app is a feature. Owe Me is the reason to switch, and
nothing else in the category has it. Do not open on privacy, encryption or the
day strip — they are reasons to stay, not reasons to look.

**Never** attach a real person's name to the product. Naming it after a living
executive implies an endorsement that does not exist, which is actionable by
them and a rejection under Apple's IP guidelines before it ever gets that far.

Where to post, in rough order of return for the effort:

- **Show HN** — honest write-up of why a second column exists. This audience
  likes the BYO-database design and will say so loudly either way.
- **r/productivity**, **r/selfhosted** — the second will like that sync runs on
  a database you own. Read each one's self-promotion rules first; they are
  enforced.
- **Product Hunt** — one day of traffic, mostly other makers.
- **People who already owe you things.** A task app about chasing people sells
  itself to anyone who runs a business on follow-ups.

Not paid advertising. You would be bidding against Todoist for the word
"todo", and losing.

---

## 5. Keeping it alive without tending it

**What it costs to exist: $99 a year.** The Apple Developer Program, and
nothing else. GitHub Pages is free, Actions on a public repository is free, and
sync costs nothing because each person brings their own database.

**So it pays for itself at about ten sales a year.** At £9.99, Apple's 15%
under the Small Business Program leaves roughly £8.49, and $99 is about £79.
Ten copies. Not ten a month — ten.

That is the whole bar, and it is worth holding on to: this does not have to
become a business to stop costing you money. It has to sell ten copies.

### What breaks if nobody touches it

An unattended app does not stay working. It goes quietly, in known ways:

| What | When | What happens |
| --- | --- | --- |
| Apple Developer Program | yearly, on the enrolment date | Not renewed, the app comes off sale and TestFlight stops |
| The sync project | after a stretch with no traffic | A free Supabase project is paused. Sync fails on every device at once, saying nothing |
| Apple's minimum SDK | roughly yearly | Existing apps stay up, but no new build is accepted until Expo is upgraded |
| TestFlight builds | 90 days | Testers' copies expire. Only matters while testing |
| The privacy and support URLs | whenever Pages breaks | Apple requires them reachable. A dead privacy URL is grounds for removal |

`.github/workflows/watchdog.yml` checks the second and the last of those every
Monday and opens an issue when one has happened — once, not weekly, because a
watchdog that repeats itself is one nobody reads. The first two rows are dates
in a diary and nothing can check them for you.

### Put its own upkeep in the app

The honest way to make this self-sustaining is to let DayFlow carry it. Three
repeating tasks, in a project of its own:

- **Renew the Apple Developer Program** — yearly, a fortnight before the
  enrolment date, because a lapse takes the app off sale.
- **Open the Supabase dashboard** — monthly. Loading it is enough to keep a
  free project from pausing, and the watchdog tells you when it did not.
- **Upgrade Expo to the current SDK** — twice a year. Not urgent until a build
  is refused, at which point it is the only thing standing between a fix and
  the people who need it.

That is the entire maintenance burden. Everything else here is optional.

---

## 6. Still open

- Neither `pages/privacy.html` nor `pages/terms.html` has had a legal read.
  They are accurate; accurate is not the same as enforceable.
- `pages/terms.html` says England and Wales. If the company lands elsewhere,
  that line changes with it.
- The listing in `dayflow/APP_STORE.md` is drafted and has never been
  submitted. Screenshots are the remaining piece of work there.
