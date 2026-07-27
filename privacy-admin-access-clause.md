# Privacy policy — admin/staff access clause (draft for guineapigapp.co.uk/privacy)

**Why this is needed:** today's RLS work granted admins read access to private
messages between users (`messages_select_admin` in `supabase/admin-read-policies.sql`),
along with bookings, notifications and unpublished shops. That's a deliberate choice —
Apple Guideline 1.2 requires being able to act on reported content, and a moderator who
can't read the reported message can't act on it — but it **must be disclosed** before
launch. Several of the other items below were already true and may also be undisclosed.

Written in plain English deliberately: a privacy policy that hides this in legalese is
worse than one that says it plainly.

---

## Suggested section: "Who at Guinea Pig can see your information"

> ### Access by our team
>
> A small number of trusted staff ("admins") can access account and activity data
> through an internal admin console. We use this to keep people safe, investigate
> reports, verify identities, and meet our legal obligations. Access is limited to
> named admin accounts, and **every admin action is recorded in an audit log**.
>
> Admins can see:
>
> - **Your account details** — your full name (including surname), email address,
>   date of birth, role, and whether you're verified.
> - **Your messages.** Admins can read messages sent between users on Guinea Pig,
>   including messages that have not been reported. We do this so we can investigate
>   reports of harassment or unsafe behaviour, and act on them. **We do not read
>   messages routinely or for marketing** — but we are able to, and you should assume
>   messages on Guinea Pig are not private from us.
> - **Your bookings** — who you booked with, when, the treatment, and any note or
>   photos you attached to an application.
> - **Photos you upload** — profile pictures, portfolio images, and the photos you
>   share when applying for a treatment.
> - **Your identity verification selfie**, if you submitted one, so we can check it
>   against your profile.
> - **Your payment records** — amounts, dates and payment references. We never see or
>   store your full card details; those are handled by Stripe.
> - **Reviews, reports, and any warnings, suspensions or bans on your account.**
>
> **Our legal basis** for this access is our legitimate interest in keeping the
> community safe and preventing misuse of the service, and, where applicable,
> compliance with a legal obligation.
>
> **Identity verification selfies** are treated as sensitive information. They are
> stored in a private, access-controlled location, are visible only to admins
> reviewing a verification, and are deleted [X months] after your verification is
> decided, or when you delete your account.

---

## Also needs updating

- **Apple privacy labels** (App Store Connect) — declare that messages/user content
  and photos are collected and linked to the user. If you say messages are not
  accessible, that would now be inaccurate.
- **Play Data Safety form** — same. Google cross-checks the declaration against
  runtime behaviour, and a mismatch is a rejection risk.
- **Community guidelines / terms** — worth a line saying moderators may review
  reported content and messages, so the expectation is set in two places.

## Open decisions for you

1. **Retention period for verification selfies.** The clause has `[X months]` — this
   needs a real number. Common practice is 3–6 months after the decision. There is
   currently NO automated deletion in the codebase, so whatever you state must either
   be implemented or done manually.
2. **UK ICO registration.** Processing identity documents as a UK data controller
   generally requires ICO registration (~£40–60/year). Worth confirming.
3. **Narrower alternative.** The tighter long-term shape is admin read access limited
   to messages attached to a report, rather than all messages. That would let you make
   a much stronger privacy statement. Logged as a follow-up — the current policy is the
   pragmatic launch position, not the end state.
