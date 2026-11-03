/** Site-wide constants. No database access — safe to import anywhere. */

export const SITE_URL = 'https://cavybeauty.com'
export const SITE_NAME = 'Cavy'
export const SITE_TAGLINE = 'Be the guinea pig, get the glow.'
/**
 * The support address everywhere on the web, including the Terms, Privacy and
 * child-safety (CSAE) contact in content/legal.ts. Moved 21 Sep 2026 from
 * support@guineapigapp.co.uk, which keeps working: support@cavybeauty.com
 * forwards through Cloudflare Email Routing (audit item 62). Change it here only.
 */
export const SUPPORT_EMAIL = 'support@cavybeauty.com'

/**
 * Whether search engines may index THIS deployment. Both must hold:
 *
 *   1. PUBLIC_SITE_MODE === 'live' — exactly. 'preview', unset, 'Live', a typo:
 *      anything else is hidden.
 *   2. VERCEL_ENV === 'production'. Vercel sets it per deployment: 'production'
 *      for the production deployment, 'preview' for branch and PR deploys,
 *      'development' under `vercel dev`. It is UNSET in local `next dev` /
 *      `next build` and in GitHub Actions, so those are hidden whatever
 *      PUBLIC_SITE_MODE says. (The cost: checking the live SEO output locally
 *      now needs VERCEL_ENV=production set by hand as well.)
 *
 * When false: robots.txt disallows everything (app/robots.ts), the sitemap is
 * empty (app/sitemap.ts), and every page emits `noindex, nofollow`
 * (app/layout.tsx).
 *
 * ── "PREVIEW DEPLOYMENTS MUST NEVER BE LIVE" — NOW ENFORCED, NOT HOPED FOR ──
 * Until 21 Sep 2026 this file stated that rule and then read PUBLIC_SITE_MODE
 * alone, while the Vercel variable was scoped to Production and Preview
 * together (audit item 52). The day Production was set to 'live', every
 * preview deployment would have gone live with it. Condition 2 makes the rule
 * true in code, however the variable is scoped.
 *
 * Read at BUILD time for the prerendered robots.txt and sitemap. Vercel exposes
 * VERCEL_ENV to the build as well as at runtime ("Automatically expose System
 * Environment Variables" is on for the project), so a preview build sees
 * 'preview'. A build that somehow ran without it would be hidden, which is the
 * safe direction.
 *
 * Stays non-live until (a) the test accounts are cleared — decided 21 Sep 2026
 * — and (b) there is real inventory worth indexing.
 */
export const IS_LIVE =
  process.env.PUBLIC_SITE_MODE === 'live' && process.env.VERCEL_ENV === 'production'

/**
 * Treatment landing pages. The URL slug is deliberately NOT the database slug:
 * treatment_categories would give /lashes-models and /brows-models, which read
 * badly. `category` matches provider_treatments.category and
 * treatment_categories.name; `dbSlug` matches public_stylists.category_slugs.
 */
export interface Treatment {
  /** URL segment, e.g. 'hair-models' */
  slug: string
  /** treatment_categories.slug, used to filter public_stylists.category_slugs */
  dbSlug: string
  /** Display name, e.g. 'Hair' */
  category: string
  /** H1 noun, e.g. 'hair models' */
  noun: string
  /** One-line summary for <meta description> and the page intro. */
  summary: string
  /** Why a stylist needs a model for THIS treatment specifically. */
  why: string
  /** What the model is actually agreeing to: time, comfort, commitment. */
  expect: string
  /** Whether this treatment normally needs an allergy patch test beforehand. */
  patchTest: string | null
}

/**
 * Every field below is written per treatment on purpose. A set of pages that
 * differ only by a swapped noun is the doorway-page pattern Google penalises
 * site-wide, and it would also be useless to read: sitting for a 4-hour colour
 * is nothing like sitting for a 25-minute spray tan.
 *
 * The patch-test lines are not marketing. The database has a `patch_tests`
 * table with `model_confirmed_at` and `expires_at`, and Terms section 8 puts
 * the duty to disclose allergies on the model — so these pages say plainly
 * which treatments normally need one.
 */
export const TREATMENTS: readonly Treatment[] = [
  {
    slug: 'hair-models',
    dbSlug: 'hair',
    category: 'Hair',
    noun: 'hair models',
    summary:
      'Cuts, colour, balayage and blow-dries from stylists building their portfolios — free or discounted, across the UK.',
    why: 'Hair is the treatment stylists most need real people for. Mannequin heads don’t have a scalp, don’t have three years of box dye in them, and don’t sit differently when you cut them. Colour work especially has to be practised on hair that behaves like hair.',
    expect:
      'Cuts and blow-dries are usually an hour or two. Colour is a long appointment — a full head of highlights or a colour correction can run to four or five hours, so bring something to do. The result stays with you for months, so be honest in the chat about how far you’re willing to go.',
    patchTest:
      'Any colour service normally needs an allergy patch test 48 hours beforehand. That means two trips, not one. A stylist who skips it is cutting a corner that exists to stop people ending up in A&E.',
  },
  {
    slug: 'makeup-models',
    dbSlug: 'makeup',
    category: 'Makeup',
    noun: 'makeup models',
    summary:
      'Bridal, editorial and everyday makeup practice with MUAs building their portfolios — free or discounted, across the UK.',
    why: 'Makeup artists need faces, not palettes — different skin tones, textures, eye shapes and ages. A bridal MUA building a portfolio needs to prove they can work on someone who isn’t their flatmate, and editorial practice needs a face that photographs.',
    expect:
      'Usually 45 minutes to two hours in the chair. It’s the lowest-commitment treatment on Cavy: nothing is cut, nothing is chemically processed, and it comes off the same evening. Expect photos — that’s almost always the point.',
    patchTest: null,
  },
  {
    slug: 'lash-models',
    dbSlug: 'lashes',
    category: 'Lashes',
    noun: 'lash models',
    summary:
      'Classic, hybrid and volume lash extensions from technicians building their portfolios — free or discounted, across the UK.',
    why: 'Lash work is slow, precise and impossible to fake. A technician has to isolate a single natural lash and bond an extension to it, hundreds of times, on a real eye that blinks and waters. Every set they do on a real person is practice they can’t get any other way.',
    expect:
      'Plan for two to three hours lying still with your eyes closed — most people find it restful, but you can’t scroll your phone. You’ll need to arrive with no eye makeup, and keep them dry for the first day or so. A full set lasts a few weeks before it needs infilling.',
    patchTest:
      'Lash adhesive contains cyanoacrylate and reactions do happen, so a patch test 24–48 hours beforehand is standard. Say yes to it.',
  },
  {
    slug: 'brow-models',
    dbSlug: 'brows',
    category: 'Brows',
    noun: 'brow models',
    summary:
      'Brow lamination, tinting, waxing and shaping from stylists building their portfolios — free or discounted, across the UK.',
    why: 'Brows are the fastest way for a stylist to show a before-and-after, which is exactly why they need people with brows that aren’t already perfect. Sparse, over-plucked, unruly or grown-out brows are the most useful thing you can bring.',
    expect:
      'Usually 45 to 90 minutes. Lamination chemically straightens the hairs so they sit flat, and the effect lasts around six to eight weeks — it isn’t reversible on a whim, so be sure before you agree. Tinting fades over a few weeks.',
    patchTest:
      'Brow tint and lamination both normally need a patch test 24–48 hours beforehand. Tint reactions are one of the more common ones in the industry, so don’t wave it through.',
  },
  {
    slug: 'nail-models',
    dbSlug: 'nails',
    category: 'Nails',
    noun: 'nail models',
    summary:
      'Gel, BIAB, acrylic and nail art from technicians building their portfolios — free or discounted, across the UK.',
    why: 'Nail technicians train on plastic tips, but real nails vary in shape, length, flexibility and how well product adheres. Apex placement and structure only really click once you’ve done them on a hundred different hands — and nail art needs a canvas someone will actually photograph.',
    expect:
      'An hour for a straightforward gel set, up to two and a half for a full acrylic set with art. You sit still with your hands on the desk. The set lasts two to three weeks and needs proper removal — don’t pick it off, and ask what removal involves before you book.',
    patchTest: null,
  },
  {
    slug: 'spray-tan-models',
    // dbSlug is `spray_tan` with an UNDERSCORE — verified against
    // treatment_categories, not guessed. The URL slug keeps the hyphen because
    // that is correct for a URL. Getting this wrong renders a perfectly good
    // page that matches zero stylists, silently and forever.
    dbSlug: 'spray_tan',
    category: 'Spray tan',
    noun: 'spray tan models',
    summary:
      'Spray tanning practice with technicians building their portfolios — free or discounted, across the UK.',
    why: 'Solution strength, gun distance and coverage all change depending on someone’s natural skin tone, and streaks only show up on a real body. Technicians need to practise on people who aren’t their usual shade — pale skin especially, where a mistake is obvious.',
    expect:
      'The spray itself is 20 to 30 minutes, in a pop-up tent, in disposable underwear. You’ll need to exfoliate beforehand and skip moisturiser, deodorant and makeup on the day. You develop for a few hours, then rinse. It fades over about a week.',
    patchTest: null,
  },
  // ── Added 3 Nov 2026 ────────────────────────────────────────────
  // All three dbSlugs read back from treatment_categories, not guessed — see
  // the spray_tan note above for what guessing costs. They are single words
  // with no underscore, and `category` is the stored `name` character for
  // character, because that is what provider_treatments.category holds.
  {
    slug: 'waxing-models',
    dbSlug: 'waxing',
    category: 'Waxing',
    noun: 'waxing models',
    summary:
      'Leg, underarm, bikini and facial waxing from therapists building their portfolios — free or discounted, across the UK.',
    why: 'Hair grows in several directions on the same leg, and wax that is right for a coarse underarm will lift the skin off a lip. Therapists have to judge the temperature, hold the skin taut and pull the right way, and none of that transfers from a practice pad — it needs real hair on real skin, including skin that has never been waxed before.',
    expect:
      'Fifteen minutes for a lip or underarms, up to about an hour for full legs. You can’t shave beforehand: the hair has to be long enough for the wax to grip, which is roughly two to three weeks of growth — so this is an appointment you plan a fortnight ahead rather than book for tomorrow. It hurts, most on the first pull of each area. Expect the skin to be red and bumpy for a few hours, and to skip hot baths, saunas, swimming and sunbeds for about a day afterwards. Agree exactly which area is being waxed in the chat beforehand, not when you get there.',
    // Contraindications, not allergy, and the heading above this box says
    // "Patch test" — so the first sentence answers that question before
    // getting to the thing that actually matters.
    patchTest:
      'Waxing doesn’t normally need a patch test. What it needs is you disclosing medication and recent treatments, and that matters more. Tell the therapist in the chat if you use retinoids or acids on the area, have had a chemical peel recently, or are sunburnt: each of those thins the skin, and it can come away with the wax. Isotretinoin — Roaccutane — rules waxing out completely, during the course and for six months after it finishes. None of this is visible to a therapist. It is only safe if you say it.',
  },
  {
    slug: 'facial-models',
    dbSlug: 'facials',
    category: 'Facials',
    noun: 'facial models',
    summary:
      'Cleansing, exfoliation, extractions, massage and peels from therapists building their portfolios — free or discounted, across the UK.',
    why: 'The skill is reading the skin in front of you and changing the plan, so a therapist needs oily skin, dry skin, congested skin and skin that reacts to everything — not six versions of the same face. Extractions especially can’t be practised on anyone whose pores are already clear.',
    expect:
      'Usually 45 minutes to an hour and a quarter, lying down with a bare face and your hair tied back. Extractions are the uncomfortable part: the therapist presses around blocked pores, and it can leave you red and blotchy. Skin can look worse before it looks better, so this isn’t one to book the day before something that matters. If actives are used you may be asked to stay out of the sun, and off your own acids and retinoids, for a few days afterwards.',
    patchTest:
      'It depends which facial. A cleanse, steam, extraction and massage doesn’t normally need a patch test. Anything with actives in it — a chemical peel, glycolic or salicylic acid, a strong vitamin C — normally does, 24 to 48 hours beforehand. So ask in the chat what is actually being used, and if the answer includes a peel or an acid, ask for the patch test rather than waiting to be offered one.',
  },
  {
    slug: 'massage-models',
    dbSlug: 'massage',
    category: 'Massage',
    noun: 'massage models',
    summary:
      'Swedish, deep tissue and sports massage from therapists building their portfolios — free or discounted, across the UK.',
    why: 'Pressure is the whole skill and it can’t be learned on a cushion. A therapist needs to feel where a real back is tight, find out how differently the same pressure lands on a different body, and learn to notice when someone has gone quiet because it hurts rather than because they’re relaxed. Practising on strangers rather than friends is the part that’s hard to arrange.',
    // ⚠️ The contraindications live HERE, not in patchTest, because there is
    // no such thing as a massage patch test and the page would print the
    // heading "Patch test" over them. Same reason nails and makeup are null.
    expect:
      'Usually 30 to 90 minutes. You undress to your underwear and stay covered with towels throughout, with only the area being worked on uncovered. Say at the start how much pressure you want, and say so again if it becomes too much — someone who is practising needs to hear that more than a paying client does. Deep tissue can leave you aching for a day or two. Tell the therapist beforehand if you’re pregnant, have a recent injury, or have a circulatory condition such as a clotting disorder or varicose veins: some of those mean they change what they do, some mean they decline, and some need a doctor to say yes first. Mention nut allergies too — a lot of massage oils are nut-based, sweet almond most of all.',
    patchTest: null,
  },
] as const

export const getTreatment = (slug: string) => TREATMENTS.find((t) => t.slug === slug)

/**
 * Curated launch tranche. NOT derived from data: providers.location_text is
 * free text with no city taxonomy behind it, so city pages are hand-picked and
 * matched with a LIKE against public_stylists.location_slug.
 *
 * Deliberately small. Every treatment x N cities of near-identical templated pages
 * on a brand-new domain is the doorway pattern Google penalises site-wide;
 * expand in tranches as real inventory appears, not all at once.
 */
export interface City {
  slug: string
  name: string
}

/**
 * How many stylists a treatment page needs before it asks to be indexed.
 * Audit item 114.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY A PAGE DECIDES THIS ABOUT ITSELF
 * ══════════════════════════════════════════════════════════════════════════
 * `PUBLIC_SITE_MODE` is all-or-nothing: index everything or index nothing.
 * That made "is there enough on the site yet" a judgement somebody had to
 * remember to re-make, and on 24 Sep item 11's query showed what forgetting
 * costs — all six treatment pages had been indexing ONE stylist, whose bio
 * was test gibberish (item 93).
 *
 * A page that knows its own count can answer for itself, and keeps answering
 * as inventory arrives. Nothing to remember and nothing to flip back.
 *
 * ── WHY THREE, AND IT IS A JUDGEMENT ──────────────────────────────────────
 * Not a finding. The reasoning, so it can be argued with:
 *
 *   * ONE is a stub. It is also the specific problem we had: with one stylist
 *     in every category, all six pages showed THE SAME CARD — so they were
 *     near-duplicates of each other, which is the doorway shape, not merely
 *     thin. A threshold fixes that as a side effect.
 *   * TWO still reads as "there is nobody here".
 *   * THREE is the smallest number that looks like a LIST rather than an
 *     example, and the smallest at which two treatment pages are likely to
 *     differ from each other in substance.
 *
 * Higher would be safer for the domain and would keep the pages dark longer,
 * which costs nothing today and costs real traffic later. Three is the point
 * where a page starts being worth showing a stranger.
 *
 * ⚠️ THIS CHANGES WHAT CRAWLERS SEE, NOT WHAT PEOPLE SEE. A page below the
 * threshold still renders, still lists whoever is on it, and is still
 * reachable and linkable. It just does not ask to be ranked.
 */
export const MIN_STYLISTS_TO_INDEX = 3

export const CITIES: readonly City[] = [
  { slug: 'london',     name: 'London' },
  { slug: 'manchester', name: 'Manchester' },
  { slug: 'birmingham', name: 'Birmingham' },
  { slug: 'leeds',      name: 'Leeds' },
  { slug: 'glasgow',    name: 'Glasgow' },
  { slug: 'liverpool',  name: 'Liverpool' },
  { slug: 'bristol',    name: 'Bristol' },
  { slug: 'nottingham', name: 'Nottingham' },
] as const

export const getCity = (slug: string) => CITIES.find((c) => c.slug === slug)
