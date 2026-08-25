# Report and block, without a booking

_Item 3 of the audit. Found 19 Aug 2026, built 24 Aug 2026, proven on live data
25 Aug 2026._

**Three published statements were untrue. "Block or report anyone in one tap"
(Community Guidelines, `legal.ts:701`), "report any account or message in one tap
inside the app" (the child-safety section, `legal.ts:683`) and "you can report any
concern in the app" (Terms §12, `legal.ts:260`). Report and block existed only
inside a chat thread, and the modal demanded free text — so it was neither
"anyone" nor "one tap".**

---

## Proven end to end

| Claim | How it was shown |
|---|---|
| Files without a session | `submitReport` logged with `sessionId: null`, row landed |
| One tap, no free text | `details: ""` accepted for `child_safety` |
| Sorts to the top with a flag | Confirmed in the admin queue |
| **The flag survives resolution** | Both child-safety reports resolved, then a **spam** report filed against the same person — still top, still flagged, still carrying the line about prior child-safety history |

The last row is the one that mattered. It is keyed to the person, not the row.

---

## What was actually wrong, after correcting the audit twice

The audit's first account of this was wrong in one direction and incomplete in
another.

**The gate was "a session exists", not "a booking was accepted."** Report and
block rendered for any session you were party to, including `pending`. The web
even says so in its own comment: *"being unable to message someone is not the
same as being unable to report them."* Narrower than the audit claimed — still
untrue against the published words, because a session is a relationship you have
to have entered.

**A fourth gap nobody had listed: the web had no model profile route at all.**
`ChatThread.tsx:199` — *"a model's id here is an auth user id and there is no
page for it yet."* Fixing the three known surfaces would have left a stylist on
the web with nowhere to report a model **from**, on the side of the marketplace
being actively recruited. The gap would have moved, not closed.

**What was NOT the blocker.** The audit implied schema work. There was none to
do: `reports.session_id` has been nullable since `0004`, `gp_reports_insert`
already permits any authenticated reporter with no session or relationship
check, and the admin page already null-guards `session_id` in all three places.
Every client just happened to only offer the action from inside a chat.

---

## The trap that made this worth doing carefully

`trg_report_subjects` fills the NOT NULL `reported_email_hash` by looking the
`reported_id` up in `public.users`. Pass a `providers.id` and the row is not
found, the hash is not filled, and the insert dies on a **NOT NULL violation on
a column the caller never mentioned**. The report is lost and the explanation is
nowhere near the mistake.

That is the normal case, not a careless one: `/stylist/[id]` and
`provider/[id].tsx` both carry a `providers.id` in the route param, and the
owner's user id only arrives later. So the fix is structural rather than
careful — `reportUser` and `blockUser` take a **tagged subject**:

```ts
type ReportSubject = { userId: string } | { providerId: string }
```

There is no slot to put the wrong id in. A screen holding a provider id says so
and the helper resolves it, once, in one file. A second, runtime belt checks the
resolved id against `public.users`, so anything that still slips through fails
with a sentence instead of a constraint code.

---

## The eight reasons

Free text was the reason "one tap" was untrue, and it was worse than
inconvenient: it meant reaching the child-safety route required a distressed
person to find the right words. Seven of the eight now file in one tap; only
"Something else" asks for any.

| | Reason | Code |
|---|---|---|
| 1 | Child safety | `child_safety` |
| 2 | Sexual messages or photos I didn't ask for | `unwanted_sexual` |
| 3 | They won't take no for an answer | `wont_take_no` |
| 4 | I felt unsafe meeting them | `unsafe_in_person` |
| 5 | Threats or abuse | `threats_abuse` |
| 6 | They're not who they say they are | `impersonation` |
| 7 | Spam or a scam | `spam_scam` |
| 8 | Something else | `other` |

Child safety is first because it is the route Terms §12 and the Community
Guidelines point at and the one formal declaration among them. Its line reads:
*"Someone under 18 is involved — including if that's you — or someone is behaving
sexually towards a child."*

**"including if that's you" is load-bearing.** A minor being groomed has to see
themselves in the option, and on an 18-plus platform a minor's presence is itself
the thing to report. An option describing only a third party is one they would
scroll past. "Child safety" rather than "CSAE" for the same reason: CSAE is
Google's word, not the word anyone scans for.

Above the list, one line: *"If someone is in immediate danger, call 999."*

---

## The claim that had to be made true before it could be said

The first draft of the child-safety line ended *"We look at these first."*

There was no priority queue. `admin/app/reports/page.tsx` ordered by
`created_at`, flat. That sentence would have been the sixth published claim with
no mechanism behind it, written during the audit whose whole subject is claims
with no mechanism behind them.

So the mechanism was built rather than the sentence dropped. An unsorted category
is a label, not a mechanism.

**And the flag persists after resolution.** This is the half that is easy to
leave out. A flag living on the individual report vanishes the moment that report
is closed — so someone reported for child safety in March, dealt with, and
reported again in June for something else arrives looking new. **The history is
the signal, not the row.** A report is flagged and sorted to the top if *either*
it is a child-safety report *or* the person it is about has ever been the subject
of one.

It keys on **`reported_email_hash`**, not the user id. `0004` made `reported_id`
`ON DELETE SET NULL` precisely so reports outlive accounts, so keying the history
on it would lose the subject at the moment the trail matters most — and lose it
again for anyone who deletes and re-registers. The hash is the durable identity
`0004` created for exactly this, and already the ban-evasion signal. Second use,
same reasoning.

When the flag comes from history rather than from the report in front of them,
the queue says so — otherwise an admin reads "CHILD SAFETY" on a spam report and
assumes the badge is broken.

If `report_subject_history` fails to load, the page says so out loud and refuses
to look calm. An unflagged queue looks like a quiet queue.

---

## What the reporter is told

Silence after reporting a child-safety concern is its own failure. The cure is
not a promise:

> **Report received.** Thank you for telling us. Child-safety reports go to the
> top of our queue and we look at these first. We won't tell them you reported
> them.
>
> If someone is in immediate danger, call 999.

No outcome, no timescale — moderation is one person and *"someone will look
within X"* would be the same shape of claim this audit keeps deleting. The one
thing it does assert is the thing that was built.

For every other reason:

> **Report received.** Thank you. Someone will read this. We won't tell them you
> reported them.
>
> You can also block them, which stops them messaging you. Reporting and blocking
> are separate — doing one never does the other.

**Blocking is offered, never performed.** Nothing is blocked at that point.

---

## Report and block are independent

Neither path calls the other. You can report without blocking — you may still
have an appointment with them, or want them dealt with rather than merely hidden
— and you can block without reporting, because nobody owes an explanation for
not wanting contact. Coupling them raises the cost of the safety action, which is
the opposite of what a safety action should cost.

The block confirmation says the other half plainly: *"Blocking doesn't tell us
anything. If you want someone to look at what happened, report them as well."*

---

## Where it now works

| Surface | Subject passed | New? |
|---|---|---|
| `mobile` chat | `{ userId }` | rewired |
| `mobile/src/app/(app)/model/[id].tsx` | `{ userId }` | **new** |
| `mobile/src/app/(app)/provider/[id].tsx` | `{ providerId }` | **new** |
| `site` chat (`ChatThread`) | `{ userId }` | rewired |
| `site/app/(app)/stylist/[id]` | `{ providerId }` | **new** |
| `site/app/(app)/model/[id]` | `{ userId }` | **new route** |

The two web profile routes take **different kinds of id** and always will,
because a model has no provider row. That asymmetry is the argument for the
tagged subject in one line.

Block moved into the shared helper too, and that was not tidying. The cascade —
cancelling the pair's live bookings — existed in two hand-ported copies. A third
copy on a profile screen that quietly skipped it would leave two people who
cannot message each other holding an appointment they are still expected to keep,
which is the one outcome blocking exists to prevent.

On the web both actions moved off the browser client onto server actions, so
`ChatThread` remains the only browser-client user on the site.

---

## A profile report never carries a session, by construction

Neither profile page passes `sessionId`; `SafetyMenu` defaults it to `null` and
nothing anywhere looks a session up. So the nulls are structural, not an artefact
of the reported account having no bookings.

**It should stay that way.** Attaching the most recent session would be a guess
written into an evidence field. `session_id` is what puts "View Chat" in front of
a moderator, so a guessed one makes the report read as being *about that
appointment* when the reporter said nothing of the sort — and if the guess is an
old, unrelated booking, it is actively misleading. It would also hand a moderator
a conversation the reporter did not choose to submit.

A report filed from a profile is about the *person*. The row should say only what
the reporter actually claimed.

If moderators need the context, the right place is the admin console: look up
what sessions exist between the two parties at review time and show them as
context, rather than writing one onto the report as though the reporter had cited
it. Not built; noted here so the decision is not re-made by accident.

## Still open

**The Play Console child-safety / CSAE declaration.** Recorded as done at
`cavy-handover.md:128`; the submitted wording is not in the repo. If it asserts
an in-app reporting route for any user, it was inaccurate as filed and is now
accurate — but that needs checking against what was actually submitted, not
against this file.

**The web has no stylist-facing route to a model's profile except chat.** The
only link to `/model/[id]` anywhere on the site is in `ChatThread`, and the
dashboard renders applicant names as plain text while stylist names elsewhere are
links. So a stylist can reach a model's profile only for a model they already
have a session with; any other model is URL-only.

Today that is nearly moot — every model a stylist can see on the web arrives via
an application, which *is* a session. It stops being moot the moment stylist-side
model discovery ships (`stylist-model-discovery.md`), which is exactly when the
no-session stylist-to-model case starts to exist. Linking the model names on the
dashboard and sessions list is a small job and should happen before that.

**Legacy rows carry no `reason_code`.** Deliberate. Guessing a category from free
text could invent a child-safety flag, and an invented flag is worse than an
absent one. They read "filed before categories existed" and sort by date.
