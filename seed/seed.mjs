/**
 * seed.mjs — create believable demo accounts for store screenshots.
 *
 *   node seed/seed.mjs
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment (never committed):
 *   $env:SUPABASE_SERVICE_ROLE_KEY = '<key>'   # PowerShell, current session only
 *
 * ⚠️ THIS WRITES TO THE LIVE DATABASE. There is no staging project. Seeded
 * stylists are publishable and genuinely bookable, so they MUST be removed
 * before launch:
 *
 *     node seed/teardown.mjs
 *
 * Every account is created on @seed.guineapig.invalid — a reserved TLD that can
 * never be a real address — which is what makes teardown provably unable to
 * touch a real account.
 *
 * PHOTOS: put your AI-generated images in seed/photos/ (see seed/README.md).
 * Missing files are skipped with a warning rather than failing the run.
 */

import { createClient } from '@supabase/supabase-js'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPABASE_URL = 'https://ptluekkhiopowuyvkgnd.supabase.co'
const SEED_EMAIL_SUFFIX = '@seed.guineapig.invalid'

/**
 * Generated per run, never committed.
 *
 * This used to be a hardcoded literal, on the reasoning that teardown removes
 * every demo account anyway. On 7 Aug 2026 teardown failed on 2 of 9 accounts
 * (a foreign key from a table it did not know about blocked the auth-user
 * delete), and this repository is public — so for a while anyone could read the
 * password here and sign in as a leftover demo account. An `authenticated`
 * session is exactly what RLS grants everything to: other users' attributes,
 * Instagram handles, provider coordinates, and EXECUTE on nearby_models.
 *
 * A credential that is only safe while a cleanup script succeeds is not safe.
 * Set SEED_PASSWORD if you need a known value for a demo; otherwise the run
 * prints the generated one at the end.
 */
const PASSWORD = process.env.SEED_PASSWORD || `Seed-${randomBytes(12).toString('base64url')}!aA1`

const HERE   = path.dirname(fileURLToPath(import.meta.url))
const PHOTOS = path.join(HERE, 'photos')

// Photos are handed out in CONSECUTIVE blocks, in sorted filename order, so the
// folder reads the way you'd expect: stylist 1 gets portfolio files 1-4, stylist
// 2 gets 5-8, model 1 gets gallery 1-3, model 2 gets 4-6, and so on.
const PORTFOLIO_PER_STYLIST = 4
const GALLERY_PER_MODEL     = 3

const blockFor = (files, index, size) => files.slice(index * size, index * size + size)

const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Set it in this shell only:')
  console.error("  $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'")
  process.exit(1)
}
const db = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })

// ── Demo content ─────────────────────────────────────────────────────────────
// First name + surname INITIAL is what the app displays, so these identify nobody.

const STYLISTS = [
  { first: 'Amelia',  last: 'Rowe',     shop: 'Amelia Rowe Hair',      region: 'UK', location: 'Manchester', bio: 'Balayage and lived-in colour. I take practice models most weeks while I work through my colour diploma — expect a long appointment and a proper consultation.' },
  { first: 'Priya',   last: 'Shah',     shop: 'Studio Priya',          region: 'UK', location: 'Birmingham', bio: 'Lash tech building my portfolio in classic and hybrid sets. Patient, gentle, and I will always talk you through what I am doing.' },
  { first: 'Chloe',   last: 'Baxter',   shop: 'Chloe B Nails',         region: 'UK', location: 'Leeds',      bio: 'Gel and BIAB specialist. I love a detailed nail art brief — bring a picture and we will work out how to get there.' },
  { first: 'Nadia',   last: 'Ahmed',    shop: 'Nadia Ahmed Beauty',    region: 'UK', location: 'London',     bio: 'Bridal and occasion makeup. Looking for models with all skin tones and types so my kit and my portfolio genuinely represent everyone.' },
  { first: 'Grace',   last: 'Okafor',   shop: 'Brow Room by Grace',    region: 'UK', location: 'Bristol',    bio: 'Brow shaping, lamination and tinting. Newly qualified and building up my before-and-afters — honest feedback very welcome.' },
]

const MODELS = [
  { first: 'Sophie', last: 'Hall',    bio: 'Happy to be a guinea pig for anything hair or nails. I work shifts so I am free a lot of weekdays.',
    attrs: { hair_colour: 'Blonde', hair_type: 'Wavy', hair_length: 'Long',   hair_condition: 'Healthy',  skin_tone: 'Fair',   skin_type: 'Combination', eye_colour: 'Blue',  eye_shape: 'Almond', nail_condition: 'Short and natural' } },
  { first: 'Leah',   last: 'Bennett', bio: 'Always wanted to try a big colour change and never been brave enough to pay for one. Very easy going.',
    attrs: { hair_colour: 'Brown', hair_type: 'Straight', hair_length: 'Shoulder', hair_condition: 'Previously coloured', skin_tone: 'Medium', skin_type: 'Dry', eye_colour: 'Hazel', eye_shape: 'Round', nail_condition: 'Bitten' } },
  { first: 'Amara',  last: 'Nwosu',   bio: 'Makeup and brows mainly. I have sensitive skin so I am a good test for gentler products.',
    attrs: { hair_colour: 'Black', hair_type: 'Coily', hair_length: 'Short', hair_condition: 'Natural', skin_tone: 'Deep', skin_type: 'Sensitive', eye_colour: 'Brown', eye_shape: 'Almond', nail_condition: 'Healthy' } },
  { first: 'Jess',   last: 'Whitmore', bio: 'Student, low budget, very willing. Free most afternoons and genuinely do not mind being practised on.',
    attrs: { hair_colour: 'Red', hair_type: 'Curly', hair_length: 'Long', hair_condition: 'Dry', skin_tone: 'Fair', skin_type: 'Oily', eye_colour: 'Green', eye_shape: 'Hooded', nail_condition: 'Long and natural' } },
]

// Coordinates matter more than they look. `nearby_models` sorts by distance and,
// with a radius set, excludes anyone it can't place — so an account with no
// lat/lng shows no distance label and sorts last everywhere.
//
// Stylists sit in the city their profile actually claims; a Manchester bio with
// Kent coordinates would render as "Manchester · 2 mi" to a Kent user.
const STYLIST_COORDS = {
  Manchester: { lat: 53.4808, lng: -2.2426 },
  Birmingham: { lat: 52.4862, lng: -1.8904 },
  Leeds:      { lat: 53.8008, lng: -1.5491 },
  London:     { lat: 51.5072, lng: -0.1276 },
  Bristol:    { lat: 51.4545, lng: -2.5879 },
}

// Models spread across Kent / SE London (same patch as the real providers), a few
// miles apart so the stylist dashboard shows a realistic range rather than a
// column of identical distances. Index-matched to MODELS above.
const MODEL_COORDS = [
  { lat: 51.4060, lng: 0.0150 },   // Bromley
  { lat: 51.4462, lng: 0.2190 },   // Dartford
  { lat: 51.2720, lng: 0.1900 },   // Sevenoaks
  { lat: 51.2787, lng: 0.5217 },   // Maidstone
]

// Stylists pick CATEGORIES, not named treatments — edit-shop.tsx offers exactly
// these six and writes the category into both `name` and `category`. Seeding
// invented names like "Balayage" produced shop pages the real app can never
// produce, which is worse than useless in a store screenshot.
//
// Two categories each so the chips don't look sparse; both are plausible for
// that stylist's actual craft.
const CATEGORIES = {
  'Amelia Rowe Hair':   ['Hair', 'Makeup'],
  'Studio Priya':       ['Lashes', 'Brows'],
  'Chloe B Nails':      ['Nails', 'Spray Tan'],
  'Nadia Ahmed Beauty': ['Makeup', 'Brows'],
  'Brow Room by Grace': ['Brows', 'Lashes'],
}

// Three per shop so no stylist page looks abandoned, written to suit that
// stylist's actual craft. Ratings are deliberately not all 5★ — a wall of
// perfect scores reads as fake, and 4s make the 5s mean something.
const REVIEWS = {
  'Amelia Rowe Hair': [
    { rating: 5, comment: 'Genuinely lovely experience. Talked me through every step and I love how it turned out — you would never know it was a practice session.' },
    { rating: 5, comment: 'Went lighter than I have ever dared and she checked in constantly. Took about three hours and was worth every minute.' },
    { rating: 4, comment: 'Really happy with the colour. Ran a little over the time she quoted, but she was upfront about it and the result is lovely.' },
  ],
  'Studio Priya': [
    { rating: 5, comment: 'So welcoming and clearly knows what she is doing. Took her time and checked I was happy throughout. Would absolutely go back.' },
    { rating: 5, comment: 'I have sensitive eyes and was nervous, but she was incredibly gentle and explained the whole process first. No irritation at all.' },
    { rating: 4, comment: 'Lovely set and a really relaxing appointment. A couple of lashes came loose after a week but she offered to sort it straight away.' },
  ],
  'Chloe B Nails': [
    { rating: 5, comment: 'Took my inspiration picture and somehow made it better. Two weeks on and not a single chip.' },
    { rating: 5, comment: 'I am a nail biter and was a bit embarrassed, but she was completely unfazed and talked me through how to grow them out.' },
    { rating: 4, comment: 'Really neat work and a nice shape. Longer appointment than I expected for a practice session but I did ask for detailed art.' },
  ],
  'Nadia Ahmed Beauty': [
    { rating: 5, comment: 'She actually had shades that matched my skin properly, which is rarer than it should be. Felt like myself, just polished.' },
    { rating: 5, comment: 'Did a bridal trial for me and listened to every note. Photographed beautifully and lasted the whole day.' },
    { rating: 5, comment: 'Warm, professional and genuinely interested in what I wanted rather than doing her own thing. Cannot recommend enough.' },
  ],
  'Brow Room by Grace': [
    { rating: 5, comment: 'Best my brows have ever looked. She mapped them out and showed me before starting so there were no surprises.' },
    { rating: 4, comment: 'Lovely shape and a really careful job. The tint was slightly darker than I wanted at first but it settled within a couple of days.' },
    { rating: 5, comment: 'Newly qualified but you would not know it. Asked for honest feedback afterwards which I thought was a really good sign.' },
  ],
}

const CHAT = [
  { from: 'model',    body: 'Hi! Just applied for the Thursday slot — is that still free?' },
  { from: 'provider', body: 'Hi Sophie! Yes it is, just accepted you 🙂 Are you happy to go a bit lighter than your photos?' },
  { from: 'model',    body: 'Yes definitely, I have wanted to go lighter for ages. Anything I should do beforehand?' },
  { from: 'provider', body: 'Perfect. Come with dry, unwashed hair if you can — day-old is ideal. Allow about 3 hours.' },
  { from: 'model',    body: 'Brilliant, thank you! See you Thursday x' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

// Every write goes through one of these. The first version of this script checked
// no errors at all, so failed inserts printed nothing and the run still ended with
// "Done" — bios, characteristics, treatments and reviews were all silently missing.
const problems = []

/** A write that MUST succeed. Throws with context so the run stops at the cause. */
async function must(label, promise) {
  const { data, error } = await promise
  if (error) throw new Error(`${label} failed: ${error.message}${error.hint ? ` (${error.hint})` : ''}`)
  return data
}

/** A write that's nice-to-have (images). Records a visible warning, keeps going. */
async function attempt(label, promise) {
  const { data, error } = await promise
  if (error) { problems.push(`${label}: ${error.message}`); console.warn(`  ! ${label}: ${error.message}`); return null }
  return data
}

const email = (first, last) => `${first}.${last}${SEED_EMAIL_SUFFIX}`.toLowerCase()
const iso   = d => d.toISOString().slice(0, 10)
const slug  = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function photosIn(folder) {
  const dir = path.join(PHOTOS, folder)
  if (!existsSync(dir)) { console.warn(`  ! no seed/photos/${folder} — skipping images`); return [] }
  const files = (await readdir(dir)).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort()
  return files.map(f => path.join(dir, f))
}

async function upload(bucket, userId, filePath) {
  const body = await readFile(filePath)
  const name = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(filePath)}`
  const { error } = await db.storage.from(bucket).upload(name, body, {
    contentType: /\.png$/i.test(filePath) ? 'image/png' : 'image/jpeg',
  })
  if (error) { console.warn(`  ! upload ${bucket}: ${error.message}`); return null }
  return name
}

function publicUrl(bucket, objectPath) {
  return db.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl
}

/** Create the auth user; the auth.users trigger creates public.users + providers. */
async function createAccount({ first, last, role }) {
  const addr = email(first, last)
  const { data, error } = await db.auth.admin.createUser({
    email: addr,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      first_name: first,
      last_name:  last,
      last_initial: last[0],
      role,
      // 18+ gate: both are required at real signup, so mirror them.
      age_confirmed: true,
      terms_accepted: true,
      date_of_birth: '1996-05-14',
    },
  })
  if (error) throw new Error(`${addr}: ${error.message}`)
  const id = data.user.id
  // The trigger may race; make the row definitively correct either way.
  // onConflict 'id' is safe here — id is the primary key.
  await must(`users row for ${addr}`, db.from('users').upsert({
    id, email: addr, role, first_name: first, last_name: last,
    last_initial: last[0], date_of_birth: '1996-05-14', region: 'UK',
    is_verified: true,
  }, { onConflict: 'id' }))
  return id
}

/**
 * model_attributes has NO unique constraint on user_id, so .upsert({ onConflict:
 * 'user_id' }) raises 42P10 rather than deduping — the same trap ensureProfile
 * documents for `providers`. The app itself does select-then-update-or-insert;
 * mirror that.
 */
async function writeModelAttributes(userId, row) {
  const { data: existing } = await db
    .from('model_attributes').select('user_id').eq('user_id', userId).maybeSingle()
  if (existing) {
    await must('model_attributes update', db.from('model_attributes').update(row).eq('user_id', userId))
  } else {
    await must('model_attributes insert', db.from('model_attributes').insert({ user_id: userId, ...row }))
  }
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding demo data into the LIVE project.')
  console.log('Remove it with:  node seed/teardown.mjs\n')

  const stylistPics   = await photosIn('stylists')
  const modelPics     = await photosIn('models')
  const portfolioPics = await photosIn('portfolio')
  const galleryPics   = await photosIn('gallery')

  const madeStylists = []
  const madeModels   = []

  // ── Stylists ───────────────────────────────────────────────────────────────
  for (const [i, s] of STYLISTS.entries()) {
    console.log(`Stylist: ${s.first} ${s.last}`)
    const userId = await createAccount({ first: s.first, last: s.last, role: 'provider' })

    let picUrl = null
    if (stylistPics[i]) {
      const p = await upload('profile-pics', userId, stylistPics[i])
      if (p) {
        picUrl = publicUrl('profile-pics', p)
        await attempt('profile pic url', db.from('users').update({ profile_pic_url: picUrl }).eq('id', userId))
      }
    }

    const { data: prov } = await db.from('providers').select('id').eq('user_id', userId).maybeSingle()
    const providerId = prov?.id
    if (!providerId) { console.warn('  ! no providers row — skipping'); continue }

    // The app stores coordinates on BOTH rows (provider-dashboard writes users
    // and providers together), so seed both or distance behaves differently
    // depending on which side is asking.
    const c = STYLIST_COORDS[s.location] ?? null
    if (c) {
      await must('stylist coords (users)', db.from('users')
        .update({ latitude: c.lat, longitude: c.lng }).eq('id', userId))
    }

    await must('providers update', db.from('providers').update({
      name: s.shop, shop_handle: slug(s.shop), bio: s.bio,
      region: s.region, location_text: s.location,
      latitude: c?.lat ?? null, longitude: c?.lng ?? null,
      profile_pic_url: picUrl, is_published: true,
    }).eq('id', providerId))

    // Exactly the shape edit-shop.tsx writes: category duplicated into `name`,
    // no duration, no price.
    const treats = await must('provider_treatments insert', db.from('provider_treatments')
      .insert(CATEGORIES[s.shop].map(cat => ({ provider_id: providerId, name: cat, category: cat })))
      .select('id, name, category'))
    console.log(`  · ${treats?.length ?? 0} treatments`)

    // Availability — the overlap guard rejects clashing bookings, so keep slots
    // tidy: one morning and one afternoon per day, never overlapping.
    const slots = []
    for (let d = 2; d <= 16; d += 3) {
      const day = iso(new Date(Date.now() + d * 864e5))
      slots.push(
        { provider_id: providerId, date: day, start_time: '10:00:00', end_time: '13:00:00', active_treatments: [treats?.[0]?.id].filter(Boolean) },
        { provider_id: providerId, date: day, start_time: '14:00:00', end_time: '16:30:00', active_treatments: [treats?.[1]?.id ?? treats?.[0]?.id].filter(Boolean) },
      )
    }
    await must('availability insert', db.from('availability').insert(slots))
    console.log(`  · ${slots.length} availability slots`)

    // Portfolio — a consecutive block per stylist (1-4, 5-8, …).
    const mine = blockFor(portfolioPics, i, PORTFOLIO_PER_STYLIST)
    if (portfolioPics.length && !mine.length) {
      console.warn(`  ! no portfolio photos left for ${s.first} — need ${(i + 1) * PORTFOLIO_PER_STYLIST} files in seed/photos/portfolio`)
    }
    for (const f of mine) {
      const p = await upload('portfolio-photos', userId, f)
      if (p) await attempt('portfolio_items insert', db.from('portfolio_items').insert({
        provider_id: providerId, media_url: publicUrl('portfolio-photos', p),
        media_type: 'photo', moderation_status: 'approved',
      }))
    }

    madeStylists.push({ userId, providerId, treatments: treats ?? [], ...s })
  }

  // ── Models ─────────────────────────────────────────────────────────────────
  for (const [i, m] of MODELS.entries()) {
    console.log(`Model: ${m.first} ${m.last}`)
    const userId = await createAccount({ first: m.first, last: m.last, role: 'model' })

    if (modelPics[i]) {
      const p = await upload('profile-pics', userId, modelPics[i])
      if (p) await attempt('profile pic url', db.from('users').update({ profile_pic_url: publicUrl('profile-pics', p) }).eq('id', userId))
    }

    // Without coordinates a model gets no distance label and sorts last for every
    // stylist — and under a radius filter is excluded outright.
    const mc = MODEL_COORDS[i]
    if (mc) {
      await must('model coords', db.from('users')
        .update({ latitude: mc.lat, longitude: mc.lng }).eq('id', userId))
    }

    await writeModelAttributes(userId, { bio: m.bio, ...m.attrs })
    console.log(`  · bio + ${Object.keys(m.attrs).length} characteristics`)

    // Gallery — model-photos is PRIVATE and the app signs paths at render time,
    // so store the object PATH here, not a URL.
    const mine = blockFor(galleryPics, i, GALLERY_PER_MODEL)
    if (galleryPics.length && !mine.length) {
      console.warn(`  ! no gallery photos left for ${m.first} — need ${(i + 1) * GALLERY_PER_MODEL} files in seed/photos/gallery`)
    }
    for (const f of mine) {
      const p = await upload('model-photos', userId, f)
      // Stores the object PATH, not a URL — model-photos is private and the app
      // signs at render time.
      if (p) await attempt('model_photos insert', db.from('model_photos').insert({ user_id: userId, photo_url: p }))
    }

    madeModels.push({ userId, ...m })
  }

  // ── Completed bookings + reviews (so ratings show on profiles) ──────────────
  console.log('Bookings and reviews…')

  // Every past booking gets its OWN date. Two sessions on the same day for the
  // same stylist would be rejected by the booking-overlap trigger, and the same
  // model double-booked would look wrong in their history.
  let dayBack = 4

  for (let si = 0; si < madeStylists.length; si++) {
    const st = madeStylists[si]
    for (const [r, review] of (REVIEWS[st.shop] ?? []).entries()) {
      // Rotate the reviewer so each stylist is reviewed by DIFFERENT models —
      // the same face three times down one shop page gives the game away.
      const mo = madeModels[(si + r) % madeModels.length]
      if (!mo) continue

      const treatment = st.treatments?.[r % (st.treatments?.length || 1)]
      const past = iso(new Date(Date.now() - (dayBack += 3) * 864e5))

      // A real booking references the availability slot it was made against, so
      // create one for the past date and point at it. Previously this was omitted
      // and the session insert failed — which silently skipped the review too.
      const slot = await must('past availability slot', db.from('availability').insert({
        provider_id: st.providerId, date: past,
        start_time: '10:00:00', end_time: '13:00:00',
        active_treatments: [treatment?.id].filter(Boolean),
        is_taken: true,
      }).select('id').single())

      const sess = await must('completed session', db.from('sessions').insert({
        provider_id: st.providerId, model_user_id: mo.userId, model_id: mo.userId,
        availability_id: slot.id,
        date: past, start_time: '10:00:00', end_time: '13:00:00',
        // Slot length, not treatment length — treatments carry no duration.
        scheduled_at: `${past}T10:00:00`, duration_minutes: 180,
        treatment_id: treatment?.id ?? null,
        location_type: 'either', status: 'completed',
      }).select('id').single())

      // reviews INSERT requires a completed session — satisfied above. `tags`
      // matches what leave-review.tsx sends (an array, never null).
      await must('review', db.from('reviews').insert({
        session_id: sess.id, reviewer_id: mo.userId, reviewee_id: st.userId,
        overall_rating: review.rating, comment: review.comment, tags: [],
      }))
      console.log(`  · ${mo.first} reviewed ${st.shop} — ${review.rating}★`)
    }
  }

  // ── One accepted booking with a chat ───────────────────────────────────────
  if (madeStylists.length && madeModels.length) {
    console.log('Chat thread…')
    const st = madeStylists[0], mo = madeModels[0]
    const soon = iso(new Date(Date.now() + 4 * 864e5))
    // Use one of the slots already seeded for this stylist rather than inventing
    // a time — a clashing one would be rejected by the booking overlap trigger.
    const existingSlot = await must('slot for chat booking', db.from('availability')
      .select('id, date, start_time, end_time')
      .eq('provider_id', st.providerId).gte('date', soon)
      .order('date').limit(1).maybeSingle())

    const sess = await must('accepted session', db.from('sessions').insert({
      provider_id: st.providerId, model_user_id: mo.userId, model_id: mo.userId,
      availability_id: existingSlot?.id ?? null,
      date: existingSlot?.date ?? soon,
      start_time: existingSlot?.start_time ?? '10:00:00',
      end_time: existingSlot?.end_time ?? '13:00:00',
      scheduled_at: `${existingSlot?.date ?? soon}T${existingSlot?.start_time ?? '10:00:00'}`,
      duration_minutes: 180,
      treatment_id: st.treatments?.[0]?.id ?? null,
      location_type: 'either', status: 'accepted',
    }).select('id').single())

    let t = Date.now() - CHAT.length * 6 * 60_000
    for (const line of CHAT) {
      await must('chat message', db.from('messages').insert({
        session_id: sess.id,
        sender_id: line.from === 'model' ? mo.userId : st.userId,
        body: line.body,
        created_at: new Date(t).toISOString(),
        read_at: new Date(t).toISOString(),   // read, so no unread dot in shots
      }))
      t += 6 * 60_000
    }
    console.log(`  · ${CHAT.length} messages between ${mo.first} and ${st.first}`)
  }

  // Verify against the DB rather than trusting that the inserts above ran — the
  // first version reported "Done" while bios, characteristics, treatments and
  // reviews were all missing.
  const ids = [...madeStylists.map(s => s.userId), ...madeModels.map(m => m.userId)]
  const count = async (table, col, vals) =>
    (await db.from(table).select('*', { count: 'exact', head: true }).in(col, vals)).count ?? 0

  const providerIds = madeStylists.map(s => s.providerId)
  const checks = {
    'model_attributes': await count('model_attributes', 'user_id', madeModels.map(m => m.userId)),
    'provider_treatments': await count('provider_treatments', 'provider_id', providerIds),
    'availability':      await count('availability', 'provider_id', providerIds),
    'portfolio_items':   await count('portfolio_items', 'provider_id', providerIds),
    'model_photos':      await count('model_photos', 'user_id', madeModels.map(m => m.userId)),
    'reviews':           await count('reviews', 'reviewee_id', ids),
  }

  console.log(`\nSeeded ${madeStylists.length} stylists, ${madeModels.length} models.`)
  console.log('Rows actually in the database:')
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v > 0 ? '✓' : '✗'} ${k.padEnd(20)} ${v}`)
  }

  const empty = Object.entries(checks).filter(([, v]) => v === 0).map(([k]) => k)
  if (empty.length) console.log(`\n⚠️  NOTHING WAS WRITTEN TO: ${empty.join(', ')}`)
  if (problems.length) {
    console.log(`\n⚠️  ${problems.length} non-fatal problem(s):`)
    for (const p of problems) console.log(`  · ${p}`)
  }

  console.log(`\nSign in as any of them with password: ${PASSWORD}`)
  console.log('⚠️  REMEMBER: node seed/teardown.mjs   before launch.')
}

main().catch(e => {
  console.error(`\n✗ SEED FAILED: ${e.message}`)
  console.error('\nNothing further was written. Run `node seed/teardown.mjs` to clear the partial run,')
  console.error('fix the cause, then seed again.')
  process.exit(1)
})
