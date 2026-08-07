/** Site-wide constants. No database access — safe to import anywhere. */

export const SITE_URL = 'https://cavybeauty.com'
export const SITE_NAME = 'Cavy'
export const SITE_TAGLINE = 'Be the guinea pig, get the glow.'
export const SUPPORT_EMAIL = 'support@guineapigapp.co.uk'

/**
 * 'live' turns indexing on. Anything else (including unset) means robots.txt
 * disallows everything, the sitemap is empty, and every page emits
 * `noindex, nofollow`.
 *
 * Stays non-live until (a) `node seed/teardown.mjs` has run so seeded demo
 * stylists cannot be indexed, and (b) there is real inventory worth indexing.
 * Vercel preview deployments must never be 'live'.
 */
export const IS_LIVE = process.env.PUBLIC_SITE_MODE === 'live'

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
 * Every field below is written per treatment on purpose. Six pages that differ
 * only by a swapped noun is the doorway-page pattern Google penalises
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
] as const

export const getTreatment = (slug: string) => TREATMENTS.find((t) => t.slug === slug)

/**
 * Curated launch tranche. NOT derived from data: providers.location_text is
 * free text with no city taxonomy behind it, so city pages are hand-picked and
 * matched with a LIKE against public_stylists.location_slug.
 *
 * Deliberately small. 6 treatments x N cities of near-identical templated pages
 * on a brand-new domain is the doorway pattern Google penalises site-wide;
 * expand in tranches as real inventory appears, not all at once.
 */
export interface City {
  slug: string
  name: string
}

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
