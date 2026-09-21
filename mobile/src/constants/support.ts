/**
 * The support address everywhere in the app. Moved 21 Sep 2026 from
 * support@guineapigapp.co.uk, which keeps working: support@cavybeauty.com
 * forwards through Cloudflare Email Routing (audit item 62).
 *
 * One constant because mobile and site/ are separate packages with no shared
 * code: site/lib/site.ts holds the web's copy. Change both together.
 */
export const SUPPORT_EMAIL = 'support@cavybeauty.com'
