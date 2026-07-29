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
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPABASE_URL = 'https://ptluekkhiopowuyvkgnd.supabase.co'
const SEED_EMAIL_SUFFIX = '@seed.guineapig.invalid'
const PASSWORD = 'SeedDemo!2026'   // demo accounts only; all removed by teardown

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

const TREATMENTS = {
  'Amelia Rowe Hair':   [{ name: 'Balayage',        category: 'Hair' },   { name: 'Cut & blow dry', category: 'Hair' }],
  'Studio Priya':       [{ name: 'Classic lash set', category: 'Lashes' }, { name: 'Hybrid set',     category: 'Lashes' }],
  'Chloe B Nails':      [{ name: 'BIAB overlay',    category: 'Nails' },  { name: 'Gel & nail art', category: 'Nails' }],
  'Nadia Ahmed Beauty': [{ name: 'Occasion makeup', category: 'Makeup' }, { name: 'Bridal trial',   category: 'Makeup' }],
  'Brow Room by Grace': [{ name: 'Brow lamination', category: 'Brows' },  { name: 'Shape & tint',   category: 'Brows' }],
}

const REVIEWS = [
  { rating: 5, comment: 'Genuinely lovely experience. Talked me through every step and I love how it turned out — you would never know it was a practice session.' },
  { rating: 5, comment: 'So welcoming and clearly knows what she is doing. Took her time and checked I was happy throughout. Would absolutely go back.' },
]

const CHAT = [
  { from: 'model',    body: 'Hi! Just applied for the Thursday slot — is that still free?' },
  { from: 'provider', body: 'Hi Sophie! Yes it is, just accepted you 🙂 Are you happy to go a bit lighter than your photos?' },
  { from: 'model',    body: 'Yes definitely, I have wanted to go lighter for ages. Anything I should do beforehand?' },
  { from: 'provider', body: 'Perfect. Come with dry, unwashed hair if you can — day-old is ideal. Allow about 3 hours.' },
  { from: 'model',    body: 'Brilliant, thank you! See you Thursday x' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  await db.from('users').upsert({
    id, email: addr, role, first_name: first, last_name: last,
    last_initial: last[0], date_of_birth: '1996-05-14', region: 'UK',
    is_verified: true,
  }, { onConflict: 'id' })
  return id
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
      if (p) { picUrl = publicUrl('profile-pics', p); await db.from('users').update({ profile_pic_url: picUrl }).eq('id', userId) }
    }

    const { data: prov } = await db.from('providers').select('id').eq('user_id', userId).maybeSingle()
    const providerId = prov?.id
    if (!providerId) { console.warn('  ! no providers row — skipping'); continue }

    await db.from('providers').update({
      name: s.shop, shop_handle: slug(s.shop), bio: s.bio,
      region: s.region, location_text: s.location,
      profile_pic_url: picUrl, is_published: true,
    }).eq('id', providerId)

    // Treatments
    const { data: treats } = await db.from('provider_treatments')
      .insert(TREATMENTS[s.shop].map(t => ({ provider_id: providerId, ...t })))
      .select('id, name')

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
    await db.from('availability').insert(slots)

    // Portfolio — a consecutive block per stylist (1-4, 5-8, …).
    const mine = blockFor(portfolioPics, i, PORTFOLIO_PER_STYLIST)
    if (portfolioPics.length && !mine.length) {
      console.warn(`  ! no portfolio photos left for ${s.first} — need ${(i + 1) * PORTFOLIO_PER_STYLIST} files in seed/photos/portfolio`)
    }
    for (const f of mine) {
      const p = await upload('portfolio-photos', userId, f)
      if (p) await db.from('portfolio_items').insert({
        provider_id: providerId, media_url: publicUrl('portfolio-photos', p),
        media_type: 'photo', moderation_status: 'approved',
      })
    }

    madeStylists.push({ userId, providerId, treatments: treats ?? [], ...s })
  }

  // ── Models ─────────────────────────────────────────────────────────────────
  for (const [i, m] of MODELS.entries()) {
    console.log(`Model: ${m.first} ${m.last}`)
    const userId = await createAccount({ first: m.first, last: m.last, role: 'model' })

    if (modelPics[i]) {
      const p = await upload('profile-pics', userId, modelPics[i])
      if (p) await db.from('users').update({ profile_pic_url: publicUrl('profile-pics', p) }).eq('id', userId)
    }

    await db.from('model_attributes').upsert({ user_id: userId, bio: m.bio, ...m.attrs }, { onConflict: 'user_id' })

    // Gallery — model-photos is PRIVATE and the app signs paths at render time,
    // so store the object PATH here, not a URL.
    const mine = blockFor(galleryPics, i, GALLERY_PER_MODEL)
    if (galleryPics.length && !mine.length) {
      console.warn(`  ! no gallery photos left for ${m.first} — need ${(i + 1) * GALLERY_PER_MODEL} files in seed/photos/gallery`)
    }
    for (const f of mine) {
      const p = await upload('model-photos', userId, f)
      if (p) await db.from('model_photos').insert({ user_id: userId, photo_url: p })
    }

    madeModels.push({ userId, ...m })
  }

  // ── Completed bookings + reviews (so ratings show on profiles) ──────────────
  console.log('Bookings and reviews…')
  for (let i = 0; i < Math.min(2, madeStylists.length, madeModels.length); i++) {
    const st = madeStylists[i], mo = madeModels[i]
    const past = iso(new Date(Date.now() - (7 + i * 5) * 864e5))
    const { data: sess } = await db.from('sessions').insert({
      provider_id: st.providerId, model_user_id: mo.userId, model_id: mo.userId,
      date: past, start_time: '10:00:00', end_time: '13:00:00',
      scheduled_at: `${past}T10:00:00`, duration_minutes: 180,
      treatment_id: st.treatments?.[0]?.id ?? null,
      location_type: 'either', status: 'completed',
    }).select('id').single()
    if (!sess) continue
    // reviews INSERT requires a completed session — satisfied above.
    await db.from('reviews').insert({
      session_id: sess.id, reviewer_id: mo.userId, reviewee_id: st.userId,
      overall_rating: REVIEWS[i].rating, comment: REVIEWS[i].comment,
    })
  }

  // ── One accepted booking with a chat ───────────────────────────────────────
  if (madeStylists.length && madeModels.length) {
    console.log('Chat thread…')
    const st = madeStylists[0], mo = madeModels[0]
    const soon = iso(new Date(Date.now() + 4 * 864e5))
    const { data: sess } = await db.from('sessions').insert({
      provider_id: st.providerId, model_user_id: mo.userId, model_id: mo.userId,
      date: soon, start_time: '10:00:00', end_time: '13:00:00',
      scheduled_at: `${soon}T10:00:00`, duration_minutes: 180,
      treatment_id: st.treatments?.[0]?.id ?? null,
      location_type: 'either', status: 'accepted',
    }).select('id').single()
    if (sess) {
      let t = Date.now() - CHAT.length * 6 * 60_000
      for (const line of CHAT) {
        await db.from('messages').insert({
          session_id: sess.id,
          sender_id: line.from === 'model' ? mo.userId : st.userId,
          body: line.body,
          created_at: new Date(t).toISOString(),
          read_at: new Date(t).toISOString(),   // read, so no unread dot in shots
        })
        t += 6 * 60_000
      }
    }
  }

  console.log(`\nDone: ${madeStylists.length} stylists, ${madeModels.length} models.`)
  console.log(`Sign in as any of them with password: ${PASSWORD}`)
  console.log('\n⚠️  REMEMBER: node seed/teardown.mjs   before launch.')
}

main().catch(e => { console.error(e); process.exit(1) })
