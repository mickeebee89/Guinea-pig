/**
 * The eight things someone can report, and the words they read while doing it.
 *
 * ── THIS FILE IS DUPLICATED, DELIBERATELY ─────────────────────────────────
 * An identical copy lives at `site/lib/reportReasons.ts`. The three apps have
 * no workspace linkage, so there is nowhere shared to put it. What keeps the
 * copies honest is not discipline: migration 0021 puts a CHECK constraint on
 * `reports.reason_code` listing these same eight codes, so a client that drifts
 * gets a constraint violation on insert rather than quietly filing a category
 * nothing downstream recognises.
 *
 * Change a code here and you must change it in `site/lib/reportReasons.ts` and
 * in a new migration. Changing a LABEL is free — the label is copy, the code is
 * the contract.
 *
 * ── HOW THE COPY WAS CHOSEN ───────────────────────────────────────────────
 * This is read by someone upset, on a phone, who wants to be finished. So:
 *
 *   * Each option describes a BEHAVIOUR, not a policy category. Nobody should
 *     have to work out which legal bucket their experience falls into.
 *   * First person, their words. "They won't take no for an answer", not
 *     "Harassment".
 *   * Child safety is FIRST. It is the route Terms §12 and the Community
 *     Guidelines point at, and the one formal declaration among them. Putting
 *     it below "Spam or a scam" would say something we do not mean.
 *   * "including if that's you" is load-bearing and must not be softened. A
 *     minor being groomed has to see THEMSELVES in the option — and on an
 *     18-plus platform a minor's presence is itself the thing to report. An
 *     option that only describes a third party is one they would scroll past.
 *   * "Child safety" rather than "CSAE". CSAE is the term Google uses; it is
 *     not the term anyone scans for.
 *
 * Only `other` requires free text. Every other option can be filed in one tap,
 * which is what `legal.ts:701` has been promising.
 */

export type ReportReasonCode =
  | 'child_safety'
  | 'unwanted_sexual'
  | 'wont_take_no'
  | 'unsafe_in_person'
  | 'threats_abuse'
  | 'impersonation'
  | 'spam_scam'
  | 'other'

export type ReportReason = {
  code: ReportReasonCode
  /** Written to `reports.reason`, which is NOT NULL and is what admin displays. */
  label: string
  /** The line beneath. Empty where the label already says it all. */
  hint?: string
  /** `other` is the only one that cannot be filed without free text. */
  requiresDetails?: boolean
}

export const REPORT_REASONS: readonly ReportReason[] = [
  {
    code: 'child_safety',
    label: 'Child safety',
    hint: 'Someone under 18 is involved — including if that’s you — or someone is behaving sexually towards a child.',
  },
  {
    code: 'unwanted_sexual',
    label: 'Sexual messages or photos I didn’t ask for',
  },
  {
    code: 'wont_take_no',
    label: 'They won’t take no for an answer',
    hint: 'Pressuring me, or still contacting me after I asked them to stop.',
  },
  {
    code: 'unsafe_in_person',
    label: 'I felt unsafe meeting them',
    hint: 'Something that happened in person.',
  },
  {
    code: 'threats_abuse',
    label: 'Threats or abuse',
    hint: 'Aggressive, threatening or hateful messages.',
  },
  {
    code: 'impersonation',
    label: 'They’re not who they say they are',
    hint: 'Fake name, someone else’s photos.',
  },
  {
    code: 'spam_scam',
    label: 'Spam or a scam',
    hint: 'Selling something, asking for money, pushing me off the app.',
  },
  {
    code: 'other',
    label: 'Something else',
    hint: 'Tell us what happened.',
    requiresDetails: true,
  },
] as const

/** Shown above the list. We are not an emergency service and should not read like one. */
export const EMERGENCY_LINE = 'If someone is in immediate danger, call 999.'

/**
 * What the reporter is told once it is filed.
 *
 * Silence after reporting a child-safety concern is its own failure — but the
 * cure for it is not a promise. There is no outcome and no timescale here
 * because we cannot keep either: moderation is one person, and "someone will
 * look at it within X" would be the same shape of claim this whole audit has
 * been removing.
 *
 * "We look at these first" IS said, and it is true: migration 0021 gives the
 * report a category, and the admin queue sorts child-safety subjects to the top
 * with a flag that persists after the report is closed. It is a mechanism, not
 * a reassurance — which is the only reason it is allowed to be here.
 */
export function reportAcknowledgement(code: ReportReasonCode): { title: string; body: string } {
  if (code === 'child_safety') {
    return {
      title: 'Report received',
      body:
        'Thank you for telling us. Child-safety reports go to the top of our queue and we look at ' +
        'these first. We won’t tell them you reported them.\n\n' + EMERGENCY_LINE,
    }
  }
  return {
    title: 'Report received',
    body:
      'Thank you. Someone will read this. We won’t tell them you reported them.\n\n' +
      'You can also block them, which stops them messaging you. Reporting and blocking are separate ' +
      '— doing one never does the other.',
  }
}
