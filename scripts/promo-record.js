/**
 * promo-record — record the two demo walkthroughs for TikTok.
 *
 *   node scripts/promo-record.js            # both
 *   node scripts/promo-record.js model      # one
 *
 * Needs the demo server running with DEMO_LABEL=1, on the port in BASE below,
 * or DEMO_BASE=http://localhost:PORT.
 *
 * ⚠️ RESTART THE DEMO SERVER BEFORE RE-RUNNING. The stylist cut ACCEPTS an
 * application, and the demo store is in the dev server's memory, so a second
 * run finds the button already gone and silently records a shorter, wrong
 * video. It did exactly that on 29 Sep. Restarting resets the fixtures.
 *
 * ── WHAT COMES OUT ─────────────────────────────────────────────────────────
 * promo/video/cavy-model-walkthrough-1080x1576.webm   (raw capture)
 * promo/video/cavy-stylist-walkthrough-1080x1576.webm
 *
 * scripts/promo-ad-video.py then pads them into the 1080x1920 safe-zone frame.
 *
 * ── WHY 540x788 AT DPR 2 ───────────────────────────────────────────────────
 * Identical to the stills (see scripts/promo-ad-frame.py): 1080x1576 scales to
 * the 896x1306 safe box exactly. Recording natively at the safe-box size would
 * mean a 448px CSS viewport — a DIFFERENT layout from the stills, so the video
 * and the images would not look like the same product.
 *
 * ── NO SYNTHETIC CURSOR, ON PURPOSE ────────────────────────────────────────
 * Playwright records the page surface only: no pointer, no click feedback.
 * A fake cursor was considered and rejected — it is something added to the
 * recording that is not in the app, and the voiceover does that job instead.
 * So the PACING has to carry it, which is what the helpers below are for.
 */
const PW = 'C:/Users/micky/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'
const { chromium } = require(PW)
const fs = require('fs')
const path = require('path')

const BASE = process.env.DEMO_BASE || 'http://localhost:3001'
const OUT = path.resolve('promo/video')
const AMELIA = 'd0000000-0000-4000-8000-000000000101'
const LEAH = 'd0000000-0000-4000-8000-000000000022'
// Priya's sessions are uid(3004..3007) in fixture order; 3005 is Leah's
// pending brow application - the one the dashboard notification names.
const LEAH_SESSION = 'd0000000-0000-4000-8000-000000003005'

// ── Pacing ─────────────────────────────────────────────────────────────────
// Varied, never a metronome. A uniform beat is what makes scripted footage
// read as scripted, more than the speed does.
const rnd = (a, b) => a + Math.random() * (b - a)

/**
 * BEAT MARKERS, so the timings handed to whoever writes the voiceover are
 * MEASURED rather than estimated from extracted frames.
 *
 * Every dwell is randomised inside a range, so no two runs have the same
 * shape and a table written once goes stale on the next recording. These are
 * stamped during the run that produced the file.
 *
 * t = 0 is the moment the cut starts, which is a few tens of milliseconds
 * after Playwright begins recording the page — so treat them as +/- half a
 * second, which is well inside what a spoken line needs.
 */
let marks = []
let markT0 = 0
const mark = label => marks.push({ label, at: Date.now() - markT0 })

/**
 * ⚠️ PACING IS SCALED HERE, NOT AT SIXTY CALL SITES.
 *
 * The first cuts were too fast to follow: a viewer could not finish reading a
 * screen before it scrolled, and the scrolls themselves moved faster than the
 * eye tracks. Raised 30 Sep 2026 on Micky's note — "following it matters more
 * than the length".
 *
 * The RELATIVE rhythm is the part worth keeping (a long hold on the work, a
 * short beat before a tap), so both cuts keep their own numbers and these two
 * multipliers stretch them together. Change these, not the beats.
 */
const DWELL_SCALE = 1.5
const SCROLL_SCALE = 2.0

const dwell = (page, a, b = a) =>
  page.waitForTimeout(Math.round(rnd(a, b) * DWELL_SCALE))

/** Look, then tap: a beat with the target on screen before the click. */
async function tap(page, locator, label) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 4000 })
    await dwell(page, 350, 550)
    await locator.first().click({ timeout: 4000 })
    return true
  } catch {
    console.warn('  ! skipped (not found): ' + label)
    return false
  }
}

/**
 * A tap the cut CANNOT survive without.
 *
 * tap() warns and carries on, which is right for decoration and wrong for a
 * journey: on 30 Sep a missed button at step 5 left the last three steps
 * unrecorded and still wrote a 79-second file that looked finished. The
 * failure was in the output and would have been reported as a success. So the
 * beats that make the video the video throw instead, and there is no such
 * thing as a short run that quietly passes.
 */
async function mustTap(page, locator, label) {
  if (!(await tap(page, locator, label))) {
    throw new Error('beat failed: ' + label + ' — the cut would be wrong, not short')
  }
}

/**
 * Eased scroll with a small overshoot and settle. An instant scrollTo is the
 * single biggest tell that nobody is holding the phone.
 */
async function glide(page, heading, { overshoot = 0, ms = 700 } = {}) {
  ms = Math.round(ms * SCROLL_SCALE)
  await page.evaluate(async ({ heading, overshoot, ms }) => {
    // By heading TEXT, because a nth-of-type selector silently lands on the
    // wrong section the moment a page gains one. null = the bottom of the
    // page; a NUMBER is an absolute offset, which is how a cut scrolls back
    // to the top (0) — "down and back up" needs both ends.
    // ⚠️ NOT ONLY HEADINGS. The homepage's two role cards are labelled with a
    // <span>, so a heading-only search could not stop on the single most
    // important thing on the page. Apostrophes are normalised because the copy
    // uses the typographic one and nobody types that in a script.
    const norm = t => t.trim().toLowerCase().replace(/’/g, "'")
    const el = typeof heading === 'string'
      ? [...document.querySelectorAll('h1,h2,h3,span,p,a')]
          .find(e => norm(e.textContent).startsWith(norm(heading)))
      : null
    // ⚠️ A STRING THAT MATCHES NOTHING USED TO SCROLL TO THE BOTTOM. null means
    // "the bottom" and an unmatched string fell into the same branch, so a typo
    // or a reworded heading produced a plausible-looking scroll to the wrong
    // place and no error at all. It is thrown now, and the run stops.
    if (typeof heading === 'string' && !el) {
      throw new Error('glide target not found on the page: ' + heading)
    }
    const to = typeof heading === 'number'
      ? heading
      : el
        ? Math.max(0, el.getBoundingClientRect().top + window.scrollY - 24)
        : document.body.scrollHeight
    const from = window.scrollY
    const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
    const run = (target, dur) => new Promise(res => {
      const t0 = performance.now()
      const step = now => {
        const k = Math.min(1, (now - t0) / dur)
        window.scrollTo(0, from + (target - from) * ease(k))
        k < 1 ? requestAnimationFrame(step) : res()
      }
      requestAnimationFrame(step)
    })
    await run(to + overshoot, ms)
    if (overshoot) {
      await new Promise(r => setTimeout(r, 180))
      const settle = Math.round(260 * (ms / 700))
      const back = window.scrollY
      const t0 = performance.now()
      await new Promise(res => {
        const step = now => {
          const k = Math.min(1, (now - t0) / settle)
          window.scrollTo(0, back + (to - back) * ease(k))
          k < 1 ? requestAnimationFrame(step) : res()
        }
        requestAnimationFrame(step)
      })
    }
  }, { heading, overshoot, ms })
}

/**
 * Hide the scrollbar, as the stills do — and Next's dev indicator.
 *
 * ⚠️ THE DEV BADGE WAS IN THE FIRST CUT: a red "1 Issue" pill, bottom-left,
 * through the whole model video. It is `<nextjs-portal>`, only ever present in
 * `next dev`, and it is suppressed here rather than in next.config so the
 * suppression belongs to the RECORDING and not to the product's dev setup —
 * an error indicator you have quietly turned off is worse than one you can see.
 */
const hideChrome = page => page.addStyleTag({
  content: 'html{scrollbar-width:none !important}'
    + 'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none !important;width:0 !important}'
    + 'nextjs-portal{display:none !important}',
}).catch(() => {})

/**
 * The closing frame, shown IN the recording rather than edited on afterwards.
 *
 * It is the PNG that scripts/promo-splash.py draws, embedded as a data URI —
 * one piece of artwork, used by the stills and the video alike. Drawing it a
 * second time in HTML here would be a copy free to drift from the original,
 * which is the fault this whole session keeps finding.
 */
async function splash(page, who, ms) {
  // One per audience: the headline and the domain are shared, the middle line
  // is not. A model is asked to help build the thing; a stylist is offered
  // models. Passing the wrong `who` would end a video on the other side's ask.
  const file = path.join(OUT, `splash-${who}-540x788.png`)
  if (!fs.existsSync(file)) {
    // Loud, because a missing splash is invisible in a video file: it would
    // just end a beat early, which is exactly how a bad cut gets called good.
    throw new Error('no splash at ' + file + ' — run: python scripts/promo-splash.py')
  }
  const b64 = fs.readFileSync(file).toString('base64')
  await page.setContent('<style>html,body{margin:0;background:#FFF7FA;overflow:hidden}'
    + 'img{display:block;width:100vw;height:100vh;object-fit:cover}</style>'
    + '<img src="data:image/png;base64,' + b64 + '">')
  await page.waitForTimeout(ms)
}

/**
 * Visit every route the cuts use, before recording, on a throwaway page.
 *
 * This is a DEV server: the first request to a route compiles it, which is one
 * to three seconds of blank screen. Recorded, that is a freeze in the middle of
 * the advert. Every route here is read-only — nothing is clicked, so the demo
 * store is untouched and the recording still starts from the seeded state.
 */
async function warm(browser) {
  const page = await browser.newPage({ viewport: { width: 540, height: 788 } })
  const A = 'd0000000-0000-4000-8000-000000000101'
  const routes = ['/', '/demo?as=model&to=%2Fdashboard', '/browse',
    '/browse?category=Hair&within=any', `/stylist/${A}`, `/stylist/${A}/apply`,
    '/messages/d0000000-0000-4000-8000-000000003000',
    '/demo?as=stylist&to=%2Favailability', '/dashboard', '/bookings']
  for (const r of routes) {
    await page.goto(BASE + r, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(250)
  }
  await page.close()
}

/**
 * BEAT 1, SHARED BY BOTH CUTS. The homepage, read in stops.
 *
 * ⚠️ IT USED TO BE ONE CONTINUOUS SCROLL from top to bottom, which meant the
 * first thing a viewer ever saw was also the least readable beat in either
 * video: the page moved past faster than anyone could read a line of it.
 * Raised by Micky, 30 Sep 2026.
 *
 * So it stops. Each stop scrolls to one section and holds long enough to read
 * it — the hero, the two sides of the swap, how it works, and the fact that
 * there are real stylists on it. Nothing here scrolls past anything.
 *
 * ONE COPY, CALLED BY BOTH CUTS, deliberately. The same beat written out twice
 * is two places to fix and one place to forget, which is exactly what went
 * wrong with FeaturedStylists and safeList in the site itself.
 */
async function homepage(page) {
  mark('1a homepage: the lockup and the tagline')
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await hideChrome(page)
  await dwell(page, 2400, 2800)                   // the lockup and the tagline

  mark('1b homepage: the stylist side')
  await glide(page, 'I’m a stylist', { ms: 600 })
  await dwell(page, 1800, 2100)                   // "You need people to practise on."
  mark('1c homepage: the model side')
  await glide(page, 'I’m a model', { ms: 550 })
  await dwell(page, 1800, 2100)                   // "You want the treatment."

  mark('1d homepage: how it works')
  await glide(page, 'How it works', { ms: 600 })
  await dwell(page, 1600, 1900)
  mark('1e homepage: turn up and glow')
  await glide(page, 'Turn up and glow', { ms: 600 })
  await dwell(page, 1800, 2100)                   // the third step, read in place

  mark('1f homepage: stylists already on Cavy')
  await glide(page, 'Stylists already on Cavy', { ms: 600 })
  await dwell(page, 2000, 2300)                   // real shops, not an empty state
}

// ── The two walkthroughs ───────────────────────────────────────────────────
const CUTS = {
  /**
   * A MODEL, END TO END. The nine beats Micky set on 30 Sep 2026:
   *   1 homepage          5 her shop: bio, work, availability
   *   2 model dashboard   6 apply for a slot
   *   3 browse + filters  7 ALL SEVEN wizard steps, through to sent
   *   4 open her shop     8 the chat, accepted   9 the closing frame
   *
   * ~60s. Long for TikTok, and deliberately so: beat 7 is the centrepiece and
   * the only part nobody can see today, so it keeps every step. The voiceover
   * carries the length.
   *
   * ⚠️ AMELIA, AND SHE IS REACHED BY FILTERING. The previous cut used Nadia
   * because Amelia is not in Browse by default — she is 27 miles away and the
   * default radius is 20. That left the video applying to one stylist in beat 7
   * and chatting to a different one in beat 8, because the demo's accepted
   * thread is Amelia's. Filtering to Hair AND "Any distance" brings her into
   * the list, so one person runs through all nine beats.
   *
   * That "Any distance" link only started working on 30 Sep (item 130 — it was
   * emitting no parameter at all, so it silently kept the 20-mile default).
   * This cut would not have been possible the day before.
   */
  model: async page => {
    // ── 1. Homepage, signed out: what a stranger actually lands on. ────────
    await homepage(page)

    // ── 2. Her dashboard. ─────────────────────────────────────────────────
    mark('2 her dashboard')
    await page.goto(`${BASE}/demo?as=model&to=%2Fdashboard`, { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 1300, 1600)
    await glide(page, null, { ms: 1200 })
    await dwell(page, 1400, 1600)
    await glide(page, 0, { ms: 900 })
    await dwell(page, 600, 750)

    // ── 3. Browse, narrowed with the filters. ─────────────────────────────
    mark('3 browse, all stylists')
    await mustTap(page, page.getByRole('link', { name: 'Browse', exact: true }).first(), 'Browse')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1700, 2000)

    mark('3b browse, filtered to Hair')
    await mustTap(page, page.getByRole('link', { name: 'Hair', exact: true }), 'Hair filter')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1300, 1500)                       // one result, no photo

    mark('3c browse, Any distance - Amelia appears')
    await mustTap(page, page.getByRole('link', { name: 'Any distance', exact: true }), 'Any distance')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1500, 1800)                       // and Amelia appears

    // ── 4. Her shop. BY NAME, never .first(): the first card is Ellie
    //      Harper, and I once described this path as Nadia while it was
    //      clicking Ellie. Naming her fails loudly if she drops out. ───────
    mark('4 her shop: bio and treatments')
    await mustTap(page, page.locator('a[href^="/stylist/"]')
      .filter({ hasText: 'Amelia Rowe Hair' }), 'Amelia Rowe Hair card')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1600, 1900)                       // bio, on arrival

    // ── 5. Down her shop and back up. Page order is About, Treatments,
    //      Availability, Work, Reviews — so down reaches Work, and coming
    //      back up lands on Availability, where Apply is. ─────────────────
    await glide(page, 'Treatments', { ms: 700 })
    await dwell(page, 1000, 1300)
    mark('5 her shop: work photos')
    await glide(page, 'Work', { overshoot: 90, ms: 900 })   // the deliberate one
    await dwell(page, 2200, 2500)                            // hold on her work
    mark('5b her shop: availability')
    await glide(page, 'Availability', { ms: 750 })
    await dwell(page, 1700, 2000)                            // the calendar

    // ── 6. Apply. ─────────────────────────────────────────────────────────
    mark('6 apply')
    await mustTap(page, page.getByRole('link', { name: /Apply for a session/i }), 'Apply')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)

    // ── 7. All seven steps. ───────────────────────────────────────────────
    // ⚠️ :not([disabled]) ON THE SLOT PICKERS. A taken slot renders as a
    // disabled button, and .first() on a disabled one hangs for 30 seconds
    // and then fails the whole run. It did, after a discovery pass had
    // booked that very slot.
    const pick = () => page.locator('ul button:not([disabled])').first()

    mark('7a step 1 of 7: choose a date')
    await dwell(page, 1700, 2000)                            // STEP 1 date
    await mustTap(page, pick(), 'date')
    mark('7b step 2 of 7: pick a time, with the price')
    await dwell(page, 1600, 1900)                            // STEP 2 time + price
    await mustTap(page, pick(), 'time')
    mark('7c step 3 of 7: select a treatment')
    await dwell(page, 1500, 1800)                            // STEP 3 treatment
    await mustTap(page, pick(), 'treatment')

    mark('7d step 4 of 7: add a note')
    await dwell(page, 1200, 1400)                            // STEP 4 note
    // ⚠️ SPELLCHECK OFF, FOR THE RECORDING ONLY. Chrome's dictionary is US, so
    // it red-underlined "coloured" — a wobbly red line under the correct
    // British spelling, in an advert, for two seconds. Suppressed here for the
    // same reason as the dev badge: it belongs to the browser doing the
    // recording, not to the product.
    const note = page.locator('textarea').first()
    await note.evaluate(el => { el.spellcheck = false })
    // ⚠️ HER HAIR IS IN WAIST-LENGTH BOX BRAIDS in all three of her photos, and
    // this used to read "Never been coloured, happy to go lighter" over the top
    // of them. The words and the pictures have to be about the same person.
    await note.pressSequentially(
      'Braids come out the week before, so this would be on my natural hair.',
      { delay: 38 })
    await dwell(page, 900, 1200)
    // "Skip" until there is something to keep; "Next" after. Both, in order.
    // ⚠️ NOT AN EXACT MATCH. Step 5's button reads "Next with 1 photo" once a
    // photo is chosen, and an anchored /^(Next|Skip)$/ silently found nothing:
    // the run carried on, skipped the last three steps and still produced a
    // video file, 79 seconds long, that simply stopped halfway through the
    // wizard. A missing click does not fail a recording — it shortens it.
    await mustTap(page, page.getByRole('button', { name: /^(Next|Skip)/ }), 'past the note')

    mark('7e step 5 of 7: share photos')
    await dwell(page, 1700, 2000)                            // STEP 5 photos
    await mustTap(page, page.locator('button:has(img)').first(), 'a photo of her own')
    await dwell(page, 850, 1050)
    await mustTap(page, page.getByRole('button', { name: /^(Next|Skip)/ }), 'past the photos')

    mark('7f step 6 of 7: the six consent ticks')
    await dwell(page, 1900, 2200)                            // STEP 6 consent
    const boxes = page.locator('input[type=checkbox]')
    const n = await boxes.count()
    for (let i = 0; i < n; i++) {
      await boxes.nth(i).check()                             // auto-scrolls to each
      await dwell(page, 260, 420)
    }
    await dwell(page, 700, 900)
    await mustTap(page, page.getByRole('button', { name: /Agree and continue/i }), 'Agree and continue')

    mark('7g step 7 of 7: review and send')
    await dwell(page, 2100, 2400)                            // STEP 7 review
    await mustTap(page, page.getByRole('button', { name: /Send my application/i }), 'Send')
    mark('7h application sent')
    await dwell(page, 2400, 2700)                            // "Application sent"

    // ── 8. The thread, accepted, ending on her line. ──────────────────────
    mark('8 the chat, accepted')
    await page.goto(`${BASE}/messages/d0000000-0000-4000-8000-000000003000`,
      { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 3200, 3500)

    // ── 9. The closing frame. ─────────────────────────────────────────────
    mark('9 closing frame')
    await splash(page, 'model', 3000)
  },

  /**
   * A STYLIST, END TO END. The nine beats Micky set on 30 Sep 2026:
   *   1 homepage            6 the applicant's profile
   *   2 stylist dashboard   7 back, and accept
   *   3 edit shop           8 the thread that acceptance just unlocked
   *   4 add a slot, saved   9 the closing frame
   *   5 the application
   *
   * Signed in as Priya Shah Lash & Brow. The applicant is LEAH B. throughout,
   * because she is the one the dashboard notification names, so beats 5, 6, 7
   * and 8 are one person without contrivance.
   *
   * ⚠️ BEAT 8 IS ONE-SIDED, AND THAT IS THE HONEST VERSION. There is no
   * conversation to show: the product DISABLES the composer until a booking is
   * confirmed ("You'll be able to message once this booking is confirmed"), so
   * a pre-acceptance exchange cannot exist, and the thread opens empty the
   * moment Priya accepts. Writing messages into it would depict a chat the
   * product refuses to allow. So she types the first one, live, and the beat
   * shows the real behaviour instead: the chat unlocks BECAUSE she accepted.
   *
   * ⚠️ RESTART THE DEMO SERVER BEFORE EVERY RUN. This cut mutates the store
   * twice — it inserts an availability slot and it accepts an application. A
   * second run on a warm server found Leah already accepted and quietly
   * accepted Jess instead, recording a different video that looked fine.
   */
  stylist: async page => {
    // ── 1. Homepage, signed out. ──────────────────────────────────────────
    await homepage(page)

    // ── 2. Her dashboard. ─────────────────────────────────────────────────
    mark('2 her dashboard')
    await page.goto(`${BASE}/demo?as=stylist&to=%2Fdashboard`, { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 1800, 2100)                       // "Good morning, Priya"
    await glide(page, null, { ms: 1300 })
    await dwell(page, 1600, 1900)
    await glide(page, 0, { ms: 950 })
    await dwell(page, 600, 800)

    // ── 3. Her shop, and what she can change about it. ────────────────────
    mark('3 her shop, top')
    await mustTap(page, page.getByRole('link', { name: 'Shop', exact: true }).first(), 'Shop')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1500, 1800)
    mark('3b her shop: photo, name, area, postcode')
    await glide(page, 'Your photo', { ms: 750 })
    await dwell(page, 1400, 1700)
    mark('3c her shop: bio and the treatments she offers')
    await glide(page, 'What you offer', { overshoot: 70, ms: 850 })
    await dwell(page, 1900, 2200)                       // the treatment chips

    // ── 4. Availability: add a slot, save it, and GO BACK IN TO SEE IT. ───
    mark('4 availability, today')
    await mustTap(page, page.getByRole('link', { name: 'Availability', exact: true }).first(), 'Availability')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1600, 1900)                       // today, with its slots

    mark('4b adding a slot: times, price, treatment')
    await mustTap(page, page.getByRole('button', { name: /^Add a slot$/ }), 'Add a slot')
    await dwell(page, 900, 1100)
    const times = page.locator('input[type=time]')
    const n = await times.count()
    await times.nth(n - 2).fill('16:00')
    await dwell(page, 450, 600)
    await times.nth(n - 1).fill('18:00')
    await dwell(page, 700, 900)
    await mustTap(page, page.getByRole('button', { name: /^(Lashes|Brows)$/ }).last(), 'a treatment')
    await dwell(page, 700, 900)
    await mustTap(page, page.getByRole('button', { name: /^Save this day$/ }), 'Save this day')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1500, 1800)

    // ⚠️ THE SCROLL IS WHAT THE BEAT NEEDS, not the click.
    //
    // I first reported this as "saving returns to the month calendar with no
    // confirmation banner". Both halves were wrong, and looking at the frames
    // is what corrected them: saving RELOADS the page, which resets scroll to
    // the top, and the day editor is still open below the month grid — with a
    // rose "Saved." under the button. I had only read the first 260 characters
    // of the page text, which stops above it.
    //
    // So the first cut showed a grid after saving because the payoff was below
    // the fold, not because the product hid it. The click re-opens the same day
    // deterministically; the glide is what puts three slots and "Saved." on
    // screen, which is where "until it's saved" actually lands.
    // ⚠️ BY TODAY'S DATE, NOT .first(). Every calendar cell is a link of this
    // shape, and the FIRST one in the DOM is the 1st of the month — an empty
    // day. The same .first() mistake put Ellie Harper in a shot I described as
    // Nadia; a locator that happens to be right today is not right.
    const d = new Date()
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      + `-${String(d.getDate()).padStart(2, '0')}`
    await mustTap(page, page.locator(`a[href*="date=${iso}"]`).first(), 'back into the day')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 800, 1000)
    // ⚠️ AND SCROLL TO THEM. The day editor sits BELOW the month grid, so
    // re-opening the day lands on the calendar and the payoff is off-screen.
    // The first cut did exactly that: it saved a slot and then showed a grid.
    mark('4c saved - three slots where there were two')
    // TODAY'S weekday, for the same reason as the date above: this read
    // 'Wednesday' because the cut was written on 30 Sep, and threw on any
    // other day. The editor heading is "Saturday 3 October 2026".
    await glide(page, d.toLocaleDateString('en-GB', { weekday: 'long' }), { ms: 800 })
    await dwell(page, 2600, 3000)                       // 10:00, 14:00 and 16:00

    // ── 5. The application waiting. ───────────────────────────────────────
    mark('5 the application waiting')
    await mustTap(page, page.getByRole('link', { name: 'Bookings', exact: true }).first(), 'Bookings')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1100, 1300)
    // The bookings page opens on its own month grid too, with the applicant
    // half-cut at the bottom edge. Beat 5 is the APPLICATION, so go to it.
    await glide(page, 'Awaiting', { ms: 750 })
    await dwell(page, 2200, 2600)                       // Leah B., with Accept

    // ── 6. Who she is. BY HER LINK, not .first(): there are three applicants
    //      and the one being accepted must be the one being read. ──────────
    mark('6 the applicant: her bio and details')
    await mustTap(page, page.locator(`a[href="/model/${LEAH}"]`).first(), 'Leah profile')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 2200, 2500)                       // her bio
    mark('6b the applicant: her photos')
    await glide(page, 'Photos', { overshoot: 70, ms: 800 })
    await dwell(page, 2000, 2300)
    await glide(page, 0, { ms: 800 })
    await dwell(page, 900, 1100)

    // ── 7. Back, and accept. ──────────────────────────────────────────────
    mark('7 back to the application')
    await page.goBack({ waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 700, 900)
    await glide(page, 'Awaiting', { ms: 700 })
    await dwell(page, 1100, 1400)
    mark('7b accepted - she moves to Confirmed')
    await mustTap(page, page.getByRole('button', { name: /^Accept$/ }).first(), 'Accept')
    await dwell(page, 2600, 3000)                       // she moves to Confirmed

    // ── 8. The thread acceptance just unlocked. ───────────────────────────
    mark('8 the chat the acceptance unlocked')
    await page.goto(`${BASE}/messages/${LEAH_SESSION}`, { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 1800, 2100)                       // empty, and now writable
    const composer = page.locator('textarea, input[placeholder*="essage" i]').first()
    await composer.click()
    await dwell(page, 400, 600)
    mark('8b she types the first message')
    await composer.pressSequentially(
      'Hi Leah! Lovely to have you. Could you come in for a patch test 48 hours before?',
      { delay: 34 })
    await dwell(page, 800, 1000)
    await mustTap(page, page.getByRole('button', { name: /^Send$/ }), 'Send')
    await dwell(page, 2600, 3000)                       // her message, sent

    // ── 9. The closing frame, the stylist's one. ──────────────────────────
    mark('9 closing frame')
    await splash(page, 'stylist', 3000)
  },
}

;(async () => {
  const want = process.argv[2] ? [process.argv[2]] : Object.keys(CUTS)
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  process.stdout.write('warming routes… ')
  await warm(browser)
  console.log('done')

  for (const name of want) {
    if (!CUTS[name]) { console.error('no such cut: ' + name); continue }
    console.log('\nrecording ' + name + '…')
    const t0 = Date.now()
    const context = await browser.newContext({
      viewport: { width: 540, height: 788 },
      deviceScaleFactor: 2,
      // ⚠️ THE VIDEO SIZE IS THE VIEWPORT'S CSS SIZE, NOT THE DEVICE SIZE.
      // deviceScaleFactor sharpens what the PAGE renders, but Playwright's
      // recorder works in CSS pixels: asking for 1080x1576 here does not
      // upscale, it pads the 540x788 capture into a larger canvas with grey.
      // Verified by extracting a frame from the first attempt, 29 Sep 2026.
      //
      // So record 1:1 and let the compositor scale. 540x788 is 0.685 aspect
      // and the 896x1306 safe box is 0.686, so the upscale is uniform and
      // nothing is distorted.
      recordVideo: { dir: OUT, size: { width: 540, height: 788 } },
    })
    const page = await context.newPage()
    marks = []
    markT0 = Date.now()
    await CUTS[name](page)
    const video = page.video()
    await context.close()                                // finalises the file
    const tmp = await video.path()
    const dst = path.join(OUT, `cavy-${name}-walkthrough-540x788.webm`)
    if (fs.existsSync(dst)) fs.unlinkSync(dst)
    fs.renameSync(tmp, dst)
    console.log('  ' + path.basename(dst)
      + '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'
      + '  ' + (fs.statSync(dst).size / 1048576).toFixed(2) + ' MB')

    // The beat sheet, measured during the run that just wrote the file.
    const clock = ms => Math.floor(ms / 60000) + ':'
      + String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
    const total = Date.now() - markT0
    console.log('\n  ' + name + ' beat sheet')
    marks.forEach((m, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].at : total
      console.log('    ' + clock(m.at) + ' - ' + clock(end) + '  ' + m.label)
    })
    fs.writeFileSync(path.join(OUT, `beats-${name}.txt`),
      marks.map((m, i) => {
        const end = i + 1 < marks.length ? marks[i + 1].at : total
        return clock(m.at) + '\t' + clock(end) + '\t' + m.label
      }).join('\n') + '\n')
  }

  await browser.close()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
