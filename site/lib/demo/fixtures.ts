/**
 * DEMO MODE — the made-up data. Audit item 69.
 *
 * ⚠️ RULES FOR THIS FILE, BECAUSE THE SCREENSHOTS ARE FOR ADVERTISING
 *
 *   * NO REVIEWS, RATINGS OR TESTIMONIALS. `reviews` is empty, every
 *     `rating` is null and every `review_count` is 0. UK law bans fake
 *     reviews (DMCC Act 2024, in force April 2025), and a screenshot of an
 *     invented five-star rating in an advert is exactly that. Nothing in a bio,
 *     a message or a status post may praise a stylist in a customer's voice
 *     either.
 *   * NO PHOTOS OF REAL PEOPLE. Every picture is null, so the site's own
 *     initials placeholder shows. Micky's own licensed images can be dropped
 *     into public/demo-images/ (gitignored) — see lib/demo/README.md.
 *   * EVERY PERSON IS INVENTED. Names were picked to sound ordinary, not to
 *     match anyone; the email domain is `.invalid`, which cannot exist.
 *
 * Dates are relative to the day the dev server starts, so availability is
 * always upcoming and "completed" bookings are always in the past.
 *
 * No price appears anywhere, because no screen on the site shows one:
 * provider_treatments has no price the site writes or reads.
 */
import type { Row, Tables } from './engine'

const DAY = 86_400_000
const d = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)
const at = (offset: number, hhmm = '09:00') =>
  new Date(`${d(offset)}T${hhmm}:00.000Z`).toISOString()

const uid = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// ── The two accounts you can be "signed in" as ─────────────────────────────
export const DEMO_MODEL_ID = uid(1)
export const DEMO_STYLIST_ID = uid(2)

// ── Treatments. Names match lib/site.ts TREATMENTS and treatment_categories. ─
const CATEGORIES = [
  { name: 'Hair', slug: 'hair' },
  { name: 'Makeup', slug: 'makeup' },
  { name: 'Lashes', slug: 'lashes' },
  { name: 'Brows', slug: 'brows' },
  { name: 'Nails', slug: 'nails' },
  { name: 'Spray tan', slug: 'spray_tan' },
]

interface StylistSeed {
  key: string
  userId: string
  first: string
  last: string
  shop: string
  area: string
  region: string
  lat: number
  lng: number
  level: string
  bio: string
  treatments: string[]
}

const STYLISTS: StylistSeed[] = [
  {
    key: 'priya', userId: DEMO_STYLIST_ID, first: 'Priya', last: 'Shah',
    shop: 'Priya Shah Lash & Brow', area: 'Bromley, Kent', region: 'Kent', lat: 51.406, lng: 0.015,
    level: 'Newly qualified',
    bio: 'Qualified in classic lashes this spring and now adding lash lifts and brow lamination. I work from a quiet home studio near Bromley South and take my time — expect a proper consultation before we start.',
    treatments: ['Lashes', 'Brows'],
  },
  {
    key: 'hannah', userId: uid(11), first: 'Hannah', last: 'Clarke',
    shop: 'Hannah Clarke Hair', area: 'Tunbridge Wells, Kent', region: 'Kent', lat: 51.132, lng: 0.263,
    level: 'Student',
    bio: 'Level 3 hairdressing student building my colour portfolio. I’m looking for models happy to try balayage, soft face-framing highlights and gloss treatments. All colour work starts with a patch test.',
    treatments: ['Hair'],
  },
  {
    key: 'leah', userId: uid(12), first: 'Leah', last: 'Mensah',
    shop: 'Leah Mensah Makeup', area: 'Hackney, London', region: 'London', lat: 51.545, lng: -0.055,
    level: 'Trainee',
    bio: 'Makeup artist in training, focusing on bridal and soft-glam looks for every skin tone. I’d love models for evening appointments in east London while I build a varied portfolio.',
    treatments: ['Makeup'],
  },
  {
    key: 'ellie', userId: uid(13), first: 'Ellie', last: 'Harper',
    shop: 'Ellie Harper Nails', area: 'Maidstone, Kent', region: 'Kent', lat: 51.27, lng: 0.522,
    level: 'Newly qualified',
    bio: 'Nail technician practising BIAB, structured gel manicures and simple nail art. Appointments take about ninety minutes, and I’ll talk you through aftercare before you leave.',
    treatments: ['Nails'],
  },
  {
    key: 'nadia', userId: uid(14), first: 'Nadia', last: 'Rahman',
    shop: 'Brows by Nadia', area: 'Islington, London', region: 'London', lat: 51.536, lng: -0.103,
    level: 'Student',
    bio: 'Brow student practising shaping, tinting and lamination. I need models with a range of brow types, from very fine to very full, to finish my course portfolio this term.',
    treatments: ['Brows'],
  },
  {
    key: 'chloe', userId: uid(15), first: 'Chloe', last: 'Bennett',
    shop: 'Chloe Bennett Tanning', area: 'Sevenoaks, Kent', region: 'Kent', lat: 51.272, lng: 0.19,
    level: 'Trainee',
    bio: 'Spray tan technician in training, working on even coverage for fair and very fair skin. Sessions are about thirty minutes, and I’ll send you prep and aftercare notes the day before.',
    treatments: ['Spray tan'],
  },
  {
    key: 'jess', userId: uid(16), first: 'Jess', last: 'Okafor',
    shop: 'Jess Okafor Hair & Makeup', area: 'Lewisham, London', region: 'London', lat: 51.452, lng: -0.017,
    level: 'Student',
    bio: 'Hair and makeup student in south-east London. I’m practising blow-dries, updos and full event looks, and I’m happy to plan the look with you in the chat beforehand.',
    treatments: ['Hair', 'Makeup'],
  },
]

// ── Models who appear as the other party in bookings ───────────────────────
const MODELS = [
  { id: DEMO_MODEL_ID, first: 'Amara', last: 'Osei', lat: 51.482, lng: 0.0 },
  { id: uid(21), first: 'Zara', last: 'Khan', lat: 51.44, lng: 0.05 },
  { id: uid(22), first: 'Maya', last: 'Lewis', lat: 51.39, lng: 0.03 },
  { id: uid(23), first: 'Ruby', last: 'Taylor', lat: 51.41, lng: 0.07 },
]

const provId = (key: string) => uid(100 + STYLISTS.findIndex(s => s.key === key))

/**
 * An optional picture Micky has dropped in. Resolved by the server stub only
 * (it can read the disk); in the browser this is always null.
 */
export type ImageResolver = (kind: 'avatar', key: string) => string | null

export function buildTables(image: ImageResolver = () => null): Tables {
  const users: Row[] = []
  const providers: Row[] = []
  const provider_treatments: Row[] = []
  const availability: Row[] = []
  const sessions: Row[] = []
  const messages: Row[] = []
  const notifications: Row[] = []
  const status_posts: Row[] = []

  for (const m of MODELS) {
    users.push({
      id: m.id, email: `${m.first.toLowerCase()}@demo.invalid`, role: 'model',
      first_name: m.first, last_name: m.last, last_initial: m.last[0],
      is_verified: true, is_founding_provider: false, provider_fee_waived: false,
      subscription_waived: false, subscription_status: m.id === DEMO_MODEL_ID ? 'active' : 'none',
      fraud_flagged: false, region: 'London', latitude: m.lat, longitude: m.lng,
      instagram_handle: null, profile_pic_url: image('avatar', m.first.toLowerCase()),
      created_at: at(-40),
    })
  }

  let treatN = 0, slotN = 0
  const treatmentIdOf = new Map<string, string>()   // `${key}:${category}` → id

  STYLISTS.forEach((s, i) => {
    const pid = provId(s.key)
    users.push({
      id: s.userId, email: `${s.first.toLowerCase()}@demo.invalid`, role: 'provider',
      first_name: s.first, last_name: s.last, last_initial: s.last[0],
      is_verified: true, is_founding_provider: false, provider_fee_waived: false,
      subscription_waived: false, subscription_status: 'none', fraud_flagged: false,
      region: s.region, latitude: s.lat, longitude: s.lng, instagram_handle: null,
      profile_pic_url: image('avatar', s.key), created_at: at(-60 + i),
    })
    providers.push({
      id: pid, user_id: s.userId, name: s.shop, bio: s.bio,
      location_text: s.area, location: s.area, region: s.region, level: s.level,
      is_verified: true, is_published: true, first_published_at: at(-30 + i),
      rating: null, review_count: 0, profile_pic_url: image('avatar', s.key), banner_url: null,
      shop_handle: s.key, latitude: s.lat, longitude: s.lng, location_lat: s.lat, location_lng: s.lng,
      created_at: at(-60 + i),
    })
    for (const cat of s.treatments) {
      const id = uid(200 + treatN++)
      treatmentIdOf.set(`${s.key}:${cat}`, id)
      provider_treatments.push({ id, provider_id: pid, name: cat, category: cat, created_at: at(-50) })
    }
    // Upcoming slots: a morning and an afternoon on a handful of days.
    for (const day of [2, 4, 6, 9, 11, 13, 16, 18, 20]) {
      for (const [start, end] of [['10:00:00', '12:00:00'], ['14:00:00', '16:00:00']]) {
        availability.push({
          id: uid(1000 + slotN++), provider_id: pid, date: d(day + (i % 2)),
          start_time: start, end_time: end,
          active_treatments: s.treatments.map(c => treatmentIdOf.get(`${s.key}:${c}`)),
          is_taken: false, created_at: at(-10),
        })
      }
    }
  })

  /** A booking, with a slot marked taken or a past slot created for it. */
  let sessN = 0
  const book = (o: {
    stylist: string; model: string; category: string; day: number; start: string; end: string
    status: 'pending' | 'accepted' | 'completed' | 'declined' | 'cancelled'; note?: string; createdDaysAgo: number
  }) => {
    const pid = provId(o.stylist)
    const date = d(o.day)
    let slot = availability.find(a => a.provider_id === pid && a.date === date && a.start_time === o.start)
    if (!slot) {
      slot = { id: uid(1000 + slotN++), provider_id: pid, date, start_time: o.start, end_time: o.end,
        active_treatments: [treatmentIdOf.get(`${o.stylist}:${o.category}`)], is_taken: false, created_at: at(-20) }
      availability.push(slot)
    }
    slot.is_taken = o.status !== 'cancelled' && o.status !== 'declined'
    const id = uid(3000 + sessN++)
    sessions.push({
      id, provider_id: pid, model_user_id: o.model, model_id: o.model, availability_id: slot.id,
      treatment_id: treatmentIdOf.get(`${o.stylist}:${o.category}`) ?? null,
      date, start_time: o.start, end_time: o.end,
      scheduled_at: `${date}T${o.start}`, duration_minutes: 120, location_type: 'provider',
      note: o.note ?? null, status: o.status, created_at: at(-o.createdDaysAgo, '18:30'),
      cancelled_by: null, cancelled_at: null, cancellation_reason: null,
    })
    return id
  }

  const say = (session: string, sender: string, body: string, minutesAgo: number, read = true) => {
    const created = new Date(Date.now() - minutesAgo * 60_000).toISOString()
    messages.push({ id: uid(5000 + messages.length), session_id: session, sender_id: sender, body,
      created_at: created, read_at: read ? created : null })
  }

  // ── The model's bookings (signed in as Amara) ────────────────────────────
  const hannahSession = book({ stylist: 'hannah', model: DEMO_MODEL_ID, category: 'Hair', day: 6, start: '10:00:00', end: '12:00:00',
    status: 'accepted', note: 'Mid-length, dark brown, never coloured. Happy to go a couple of shades lighter.', createdDaysAgo: 4 })
  book({ stylist: 'leah', model: DEMO_MODEL_ID, category: 'Makeup', day: 9, start: '14:00:00', end: '16:00:00',
    status: 'pending', note: 'Soft glam for a wedding the following weekend, if that works as practice.', createdDaysAgo: 1 })
  book({ stylist: 'chloe', model: DEMO_MODEL_ID, category: 'Spray tan', day: 12, start: '10:00:00', end: '12:00:00',
    status: 'accepted', createdDaysAgo: 3 })
  book({ stylist: 'jess', model: DEMO_MODEL_ID, category: 'Hair', day: -12, start: '14:00:00', end: '16:00:00',
    status: 'completed', createdDaysAgo: 20 })

  const hannah = STYLISTS.find(s => s.key === 'hannah')!.userId
  // Minutes ago. One conversation over a morning, so the times read in order.
  say(hannahSession, DEMO_MODEL_ID, 'Hi Hannah, thanks for accepting! Is there anything I should do before the appointment?', 190)
  say(hannahSession, hannah, 'Hi Amara! Could you pop in for a quick patch test at least 48 hours before? Any day this week after 4pm works.', 160)
  say(hannahSession, DEMO_MODEL_ID, 'Thursday at 5 would be perfect.', 150)
  say(hannahSession, hannah, 'Lovely, Thursday at 5 it is. Come with dry, unwashed hair on the day and we’ll look at shades together first.', 40, false)

  // ── The stylist's bookings (signed in as Priya) ──────────────────────────
  const zaraSession = book({ stylist: 'priya', model: uid(21), category: 'Lashes', day: 4, start: '10:00:00', end: '12:00:00',
    status: 'accepted', note: 'First time having lashes done — I’d like something natural.', createdDaysAgo: 5 })
  book({ stylist: 'priya', model: uid(22), category: 'Brows', day: 9, start: '14:00:00', end: '16:00:00',
    status: 'pending', note: 'Quite sparse brows, interested in lamination.', createdDaysAgo: 0 })
  book({ stylist: 'priya', model: uid(23), category: 'Lashes', day: 11, start: '10:00:00', end: '12:00:00',
    status: 'pending', createdDaysAgo: 1 })
  book({ stylist: 'priya', model: uid(23), category: 'Brows', day: -8, start: '10:00:00', end: '12:00:00',
    status: 'completed', createdDaysAgo: 15 })

  say(zaraSession, uid(21), 'Hi Priya, I’ve never had extensions before — how long will it take?', 210)
  say(zaraSession, DEMO_STYLIST_ID, 'Hi Zara! A natural classic set takes about two hours. Please come without mascara, and we’ll choose the length together.', 185)
  say(zaraSession, uid(21), 'Great, see you then.', 60, false)

  // ── Notifications ────────────────────────────────────────────────────────
  notifications.push(
    { id: uid(6000), user_id: DEMO_MODEL_ID, type: 'session_accepted', title: 'Booking confirmed',
      body: 'Hannah Clarke Hair accepted your booking.', session_id: hannahSession, data: null, read_at: null, created_at: at(-4, '19:00') },
    { id: uid(6001), user_id: DEMO_STYLIST_ID, type: 'session_request', title: 'New application',
      body: 'Maya L. applied for a brow appointment.', session_id: null, data: null, read_at: null, created_at: at(0, '08:00') },
  )

  // ── "What's on near you" — an approved, unexpired stylist update ──────────
  status_posts.push(
    { id: uid(7000), provider_id: provId('hannah'), body: 'Two balayage slots free next week for models happy to go a few shades lighter.',
      moderation_status: 'approved', review_note: null, expires_at: at(3, '23:00'), created_at: at(-1) },
    { id: uid(7001), provider_id: provId('priya'), body: 'Lash lift practice slots this Saturday morning — natural looks only.',
      moderation_status: 'approved', review_note: null, expires_at: at(2, '23:00'), created_at: at(0, '07:30') },
  )

  return {
    users,
    providers,
    provider_treatments,
    treatment_categories: CATEGORIES.map((c, i) => ({ id: uid(900 + i), name: c.name, slug: c.slug, is_active: true, sort_order: i + 1 })),
    availability,
    sessions,
    messages,
    notifications,
    status_posts,
    // No reviews. See the header.
    reviews: [],
    favourites: [{ id: uid(8000), user_id: DEMO_MODEL_ID, provider_id: provId('hannah'), created_at: at(-5) }],
    blocks: [],
    portfolio_items: [],
    model_attributes: [{ user_id: DEMO_MODEL_ID, hair_colour: 'Dark brown', hair_type: 'Wavy', hair_length: 'Medium',
      hair_condition: 'Healthy', skin_tone: 'Deep', skin_type: 'Combination', eye_colour: 'Brown', eye_shape: 'Almond',
      nail_condition: 'Good', bio: 'Happy to try new looks, and I like to talk the plan through first.' }],
    model_photos: [],
    model_photo_categories: [],
    subscriptions: [{ user_id: DEMO_MODEL_ID, status: 'active', current_period_start: at(-10),
      // A customer id, invented, so lib/verification.ts's fast path settles it
      // and never asks the (switched-off) payment function.
      current_period_end: at(20), stripe_customer_id: 'cus_demo_not_real', stripe_subscription_id: 'sub_demo_not_real' }],
    verification_payments: [{ id: uid(8100), user_id: DEMO_STYLIST_ID, amount: 1499, currency: 'gbp', created_at: at(-35) }],
    verification_requests: [{ id: uid(8200), user_id: DEMO_STYLIST_ID, status: 'approved', notes: null, created_at: at(-34), reviewed_at: at(-33) }],
    suspensions: [],
    settings: [],
    founding_providers: [],
    reports: [],
    push_tokens: [],
  }
}

/** The views the site reads, derived from the base tables on every read. */
export const VIEWS: Record<string, (t: Tables) => Row[]> = {
  public_profiles: t => t.users.map(u => ({
    id: u.id, first_name: u.first_name, last_initial: u.last_initial,
    profile_pic_url: u.profile_pic_url, instagram_handle: u.instagram_handle, role: u.role,
  })),

  // Mirrors 0034's public_stylists: published, a name, a 40-character bio, a category.
  public_stylists: t => t.providers.flatMap(p => {
    const cats = t.provider_treatments.filter(pt => pt.provider_id === p.id && pt.category != null)
      .map(pt => String(pt.category))
    const categories = [...new Set(cats)].sort()
    const category_slugs = categories
      .map(c => t.treatment_categories.find(tc => String(tc.name).toLowerCase() === c.toLowerCase())?.slug as string | undefined)
      .filter((s): s is string => !!s).sort()
    const name = String(p.name ?? '').trim()
    const bio = String(p.bio ?? '').trim()
    if (p.is_published !== true || !name || bio.length < 40 || categories.length === 0) return []
    const short = String(p.id).replace(/-/g, '').slice(0, 8)
    const loc = (p.location_text ?? p.location ?? null) as string | null
    return [{
      id: p.id, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${short}`,
      short_id: short, name, bio, region: p.region, location: loc,
      location_slug: loc ? loc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null,
      profile_pic_url: p.profile_pic_url, banner_url: p.banner_url, is_verified: p.is_verified, level: p.level,
      categories, category_slugs, rating: null, review_count: 0,
      has_open_slots: t.availability.some(a => a.provider_id === p.id && String(a.date) >= new Date().toISOString().slice(0, 10)),
    }]
  }),

  public_stylist_status: t => t.status_posts
    .filter(s => s.moderation_status === 'approved' && String(s.expires_at) > new Date().toISOString())
    .map(s => ({ id: s.id, provider_id: s.provider_id, body: s.body, expires_at: s.expires_at, created_at: s.created_at })),
}
