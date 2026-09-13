/**
 * Shapes and message helpers for 0039's admin_* functions.
 *
 * ── WHY THIS IS A MODULE AND NOT A THIRD COPY ────────────────────────────
 * shopsNote and humanError were written in app/users/page.tsx, copied into
 * app/reports/page.tsx, and were about to be copied a third time into
 * app/providers/page.tsx with two more surfaces behind it. Five copies of a
 * sentence-builder is how `location` and `location_text` drifted apart for
 * months, and how the same publish rule ended up written in two places (0016).
 *
 * What is NOT lifted here: the rpc() calls themselves. Each surface passes
 * different parameters and reads different keys back, and hiding that behind a
 * wrapper would put the contract one indirection away from the person checking
 * it against the migration.
 */

/**
 * One shop, as _provider_shops_state reports it. FACTS, not a reason:
 * published, could-it-be-published (by provider_shop_is_publishable, not a
 * second copy of that rule), and has-it-ever-been-published — so "not
 * republished" can be told apart from "not ready".
 */
export interface ShopState {
  provider_id: string
  published: boolean
  publishable: boolean
  ever_published: boolean
  /**
   * OBSERVATIONS, added by 0041, and not the rule — `publishable` is the
   * verdict. They mirror provider_shop_is_publishable's own two expressions and
   * are checked against it on every provider row when 0041 applies.
   *
   * Optional because a response from before 0041 will not carry them. Read them
   * with `=== false`, never as falsy: `undefined` means "this did not say",
   * which is not the same as "no".
   */
  has_name?: boolean
  has_categorised_treatment?: boolean
}

/**
 * Everything 0039's functions return, by key. Each function fills in the
 * subset that applies to the action it ran:
 *
 *   warn | suspend | ban | reinstate | dismiss | resolve   {}
 *   verify                                                 { shops }
 *   flag | waive | comp                                    { new_value }
 *   remove_portfolio                    { removed_count, orphaned_media_urls }
 *   approved | rejected (a verification decision)
 *                    { decision, user_id, role, already_verified, shops }
 *   approved | rejected (a status-post decision)
 *                    { decision, provider_id, notify_user_id }
 */
export interface ActionResult {
  new_value?: boolean
  shops?: ShopState[]
  removed_count?: number
  orphaned_media_urls?: string[]
  decision?: 'approved' | 'rejected'
  /** Who the decision was about. The caller needs it to send the notification,
   *  which stays OUTSIDE the transaction by decision — so this is how the page
   *  addresses someone whose users row RLS may have hidden from it. */
  user_id?: string
  role?: string
  /** True when the account was ALREADY verified before this approval, so the
   *  console can stop announcing a change that did not happen. */
  already_verified?: boolean
  provider_id?: string
  /** The shop owner, resolved inside the same transaction as the decision.
   *  The moderation page used to fetch this separately AFTER the write, and
   *  skipped the notification silently if that read failed. */
  notify_user_id?: string
}

/**
 * 0039 prefixes its messages for a database log — `admin_act_on_user: suspend
 * needs a reason`. An alert is not a log, and the prefix is noise to the person
 * reading it. The rest of the sentence is left exactly as the function wrote it.
 */
export const humanError = (m: string) => m.replace(/^admin_[a-z_]+:\s*/, '')

/**
 * ── AN APPROVAL THAT DOES NOT PUBLISH TELLS NOBODY ───────────────────────
 *
 * Verifying a stylist is supposed to make their shop live. When it does not,
 * nothing on screen said so: the shop stayed hidden, the admin saw a success,
 * and the stylist was told they were verified. Jojo B sat in exactly that state
 * for four days (audit items 29 and 40).
 *
 * Returns null when there is nothing worth saying — no shops, or every shop
 * live, which is what the admin already expected.
 *
 * ⚠️ The reasons below are what this page CAN SEE, not the publish rule.
 * provider_shop_is_publishable is the rule and `publishable` is its verdict; a
 * requirement added there later makes these sentences incomplete rather than
 * wrong, which is the failure mode to prefer. Do not grow this into a second
 * copy of the rule.
 */
export function shopsNote(shops: ShopState[]): string | null {
  if (shops.length === 0) return null
  const hidden = shops.filter(sh => !sh.published)
  if (hidden.length === 0) return null

  const why = (sh: ShopState) => {
    if (sh.publishable) {
      return sh.ever_published
        ? 'it is ready, and it has been live before, so it is hidden by choice rather than by the rules'
        : 'it is ready to publish but is not live'
    }
    // 0041: name the half that is actually missing. This used to recite both
    // requirements, so a shop that HAD a name read as missing one — Micky, on
    // Test A, 12 Sep: it sends someone looking for a problem that isn't there.
    const missing = [
      sh.has_name === false ? 'a name' : null,
      sh.has_categorised_treatment === false ? 'at least one treatment with a category' : null,
    ].filter(Boolean)
    // No observation explains it: the rule is refusing for a reason this cannot
    // see. Say that, rather than naming requirements that are already met — an
    // incomplete message is the failure mode this was designed for.
    return missing.length > 0
      ? `it still needs ${missing.join(' and ')}`
      : 'it is not ready, and not because of its name or its treatments — something else in the publish rules is refusing it'
  }

  const lead = shops.length === 1
    ? 'Their shop is NOT live: '
    : `${hidden.length} of their ${shops.length} shops are NOT live: `
  return lead + hidden.map(why).join('; ') + '.'
}
