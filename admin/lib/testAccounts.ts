/**
 * Micky's own accounts — the ones whose activity is QA, not a member using
 * the product.
 *
 * ── ⚠️ WHY THIS IS ITS OWN FILE ────────────────────────────────────────────
 * It lived in `lib/activity.ts` until 28 Oct 2026, where exactly one screen
 * imported it and the name said it was a property of the Activity feed. It is
 * not: it is a property of the ACCOUNTS, and every count in this console that
 * claims to describe members has the same need. Leaving it in the dots file
 * meant the dashboard's "59 users" and the Users page went on counting seven
 * accounts that are all the same person.
 *
 * ── ⚠️ DECLARED BY ID, WITH THE ADDRESS AS THE REASON ──────────────────────
 * The id is stable and the email is readable, so both are here: a uuid alone
 * is unauditable and an email alone changes. Each entry has to be ADDED ON
 * PURPOSE — there is no pattern match on "looks like a test", because
 * `samanthaflowersamaral221@gmail.com` is a real founding provider and
 * `Fullrunthroughtest A` is not, and no rule reads those two correctly. A
 * `+tag` rule would be worse still: plus-addressing is a thing real people do.
 *
 * ── ⚠️⚠️ THIS HIDES ROWS AND SUBTRACTS FROM COUNTS. IT DELETES NOTHING ─────
 * Every slot, booking, photo and favourite these accounts made is still in the
 * database. Deleting them was considered on 27 Oct and refused: all seven are
 * unpublished with no bookable future slots, so no member can see any of them,
 * and `nahitih259` is the provider that migrations 0040, 0045, 0057 and 0100
 * used to verify their own behaviour — 0100 names it as `k_prov` in a
 * post-condition. The distortion was only ever in the reporting, so the fix is
 * in the reporting.
 *
 * ── ⚠️ NOT APPLIED TO MODERATION, VERIFICATION OR REPORTS, DELIBERATELY ────
 * Those queues are work waiting to be done. A test account appearing in one
 * means something is behaving unexpectedly, and that is the exact moment you
 * want to see it rather than have it filtered away. Filtering is for "how big
 * is this marketplace", never for "what needs my attention".
 *
 * ── ⚠️ EVERY SCREEN THAT USES THIS MUST SHOW BOTH NUMBERS ──────────────────
 * "52 members (7 test accounts hidden)", never a bare 52. A count that
 * silently excludes things reads exactly like a count that is simply wrong,
 * and there is then no way to tell a quiet week from a broken filter.
 */
export const TEST_ACCOUNT_IDS: Record<string, string> = {
  // ⚠️ A REAL ADMIN AND A REAL PERSON, AND STILL ON THE LIST. Micky's working
  // account. Its shop `49d40aae…` is `is_published = false` — measured
  // 28 Oct 2026 along with the other six, and all seven came back unpublished —
  // so no member can reach it, nobody can book it, and counting it as a
  // provider overstates a population of 7 by one in seven.
  //
  // ⚠️ IF THAT SHOP IS EVER PUBLISHED, TAKE THIS LINE OUT. A published shop is
  // a real participant in the marketplace whatever the email on it, and this
  // list would then be hiding a member from the member count. The published
  // flag is the whole reason the entry is defensible.
  //
  // Its ADMIN work is untouched by any of this: the moderation, verification
  // and reports queues do not consult this file, and the audit log records
  // 28 of 30 verification decisions against this account.
  'ff06d568-8936-45fa-ad5f-0b88c150ec30': 'micky.buckfield@gmail.com — Micky B, the stylist account',
  'b0df9c2f-02c5-4fef-afb0-9b184c3b9130': 'micky.buckfield@hotmail.co.uk — Model B, the model test account',
  'a923c7cc-e5c1-403e-96c7-addbe8fc73d3': 'micky.buckfield+stylist@gmail.com — testest T',
  '517c2853-50bb-4e8f-87fe-d79311bc37c0': 'nahitih259@bevriz.com — Fullrunthroughtest A, the migrations’ provider',
  '8788ed3d-40a6-44da-ad61-c38d0932b6d5': 'admin@guineapigapp.co.uk — the dedicated console admin',
  '740a7b41-ef6f-4bb5-9008-b2e0b2adca2e': 'micky.buckfield+model2@gmail.com — the subscription test account',
  '796aa789-a385-44ca-93c6-c4e6324f90e5': 'micky.buckfield+postcode@gmail.com — the signup-postcode test account',
}

export const TEST_ACCOUNT_ID_LIST = Object.keys(TEST_ACCOUNT_IDS)

export const isTestAccount = (userId: string | null | undefined) =>
  !!userId && userId in TEST_ACCOUNT_IDS

/**
 * The sentence that goes next to a filtered number. Returns '' at zero, so a
 * screen can render it unconditionally and nothing appears when nothing was
 * hidden — a permanent "0 test accounts hidden" trains the eye to skip the
 * line that matters.
 */
export const hiddenNote = (hidden: number, total: number) =>
  hidden > 0
    ? `${total} in all · ${hidden} test account${hidden === 1 ? '' : 's'} hidden`
    : ''
