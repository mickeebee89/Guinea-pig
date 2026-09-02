# The safety surface

_One word, one shape, every surface, both clients. Written 2 Sep 2026 after items
9 and 10 of the audit._

**If you are adding a screen where one user can see another user, this page tells
you what to put on it. It is short on purpose.**

---

## The rule

| | |
|---|---|
| **The word is "Safety"** | Not "Report". Not "Block". Not "More" or "Options". Not an icon on its own. |
| **The control is visible** | A labelled pill with a flag icon. Never a bare ellipsis. |
| **Mobile** | `mobile/src/components/SafetyButton.tsx` → opens `SafetySheet` |
| **Web** | `site/components/SafetyMenu.tsx` (the trigger is built in) |
| **Position** | Top-right of the header block that names the person |
| **Hidden only** | On your own profile, where it would mean nothing |

Report and block are **separate actions**, and neither requires the other. The
control leads to both. Both work while the other party is suspended or deleted.

---

## Why "Safety" and not "Report"

Naming it after one of the two actions hides the other. Someone who wants to stop
a person contacting them without making an accusation should not have to tap a
button called "Report" to find "Block" — that raises the cost of the safety
action, which is the opposite of what a safety action should cost.

"More" and "Options" are true of every menu in the app and so are a reason to
scroll past. "Safety" is the word someone in trouble is already thinking in.

---

## Why an `accessibilityLabel` is not a label

All three mobile surfaces already had `accessibilityLabel="Safety options"` on a
bare three-dot icon. It is worth being exact about what that bought:

**A screen-reader user could find the control. Nobody else could.**

An `accessibilityLabel` is announced to assistive technology and rendered to no
one. It made the control reachable for a minority of users, invisible to
everyone else, and — worst of the three — it read in code review as though the
labelling problem had been handled.

The label has to be on the screen. Keep the `accessibilityLabel` as well; they
are not alternatives, and `SafetyButton` sets both.

---

## Reachability is half the control

A control nobody can navigate to is not a control. On 2 Sep 2026 the web had
report and block on three surfaces and exactly **one** route to a model's
profile — inside a chat thread, which is the one place the controls already
existed. The mechanism was complete and unreachable.

So when you add a surface that shows a person:

1. **Can you get to their profile from it?** Conversation lists, session lists,
   dashboards and search results all show people. Each needs a route.
2. **If the row is already a link, do not nest an anchor** — make the avatar its
   own link, a sibling of the row link, inside a shared flex row. That nesting
   problem is why the web conversation list had no profile route for three weeks.
3. **Pass the right id.** A model is an `auth.users` id (`/model/[id]`); a
   stylist is a `providers.id` (`/stylist/[id]`). They are not interchangeable
   and passing the wrong one fails on a NOT NULL hash violation rather than
   anything legible. `reportUser`/`blockUser` take a tagged subject
   (`{ userId }` or `{ providerId }`) so there is no slot to put the wrong id in.

---

## The test

**Would someone under pressure find it without knowing it exists?**

Not "is it present". Not "did the ticket get closed". The person who commissioned
this could not find it on a profile the day it was built and had to ask where it
was — while calm, on a page he had just specified. That is the test result that
produced this page.

---

## Where it is now

| Surface | Control | Route in |
|---|---|---|
| Mobile chat | `SafetyButton` | Conversation list, session list |
| Mobile model profile | `SafetyButton` | Conversation-list avatar, sessions, provider dashboard |
| Mobile stylist profile | `SafetyButton` (banner variant) | Home cards, conversation-list avatar, chat header |
| Web chat | `SafetyMenu` | Conversation list |
| Web model profile | `SafetyMenu` | Chat header, `/sessions`, `/dashboard`, conversation-list avatar |
| Web stylist profile | `SafetyMenu` | `/browse`, `/sessions`, `/dashboard`, chat header |

Public, logged-out pages (`/[treatment]`) deliberately have no control: reporting
requires an account, and there is nobody to attribute a report to.
