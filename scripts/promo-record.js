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

// ── Pacing ─────────────────────────────────────────────────────────────────
// Varied, never a metronome. A uniform beat is what makes scripted footage
// read as scripted, more than the speed does.
const rnd = (a, b) => a + Math.random() * (b - a)
const dwell = (page, a, b = a) => page.waitForTimeout(Math.round(rnd(a, b)))

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
  await page.evaluate(async ({ heading, overshoot, ms }) => {
    // By heading TEXT, because a nth-of-type selector silently lands on the
    // wrong section the moment a page gains one. null = the bottom of the
    // page; a NUMBER is an absolute offset, which is how a cut scrolls back
    // to the top (0) — "down and back up" needs both ends.
    const el = typeof heading === 'string'
      ? [...document.querySelectorAll('h1,h2,h3')]
          .find(e => e.textContent.trim().toLowerCase().startsWith(heading.toLowerCase()))
      : null
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
      const back = window.scrollY
      const t0 = performance.now()
      await new Promise(res => {
        const step = now => {
          const k = Math.min(1, (now - t0) / 260)
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
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 1700, 2000)                       // never click on load
    await glide(page, null, { ms: 1100 })
    await dwell(page, 900, 1100)
    await glide(page, 0, { ms: 850 })
    await dwell(page, 500, 650)

    // ── 2. Her dashboard. ─────────────────────────────────────────────────
    await page.goto(`${BASE}/demo?as=model&to=%2Fdashboard`, { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 1300, 1600)
    await glide(page, null, { ms: 1200 })
    await dwell(page, 1400, 1600)
    await glide(page, 0, { ms: 900 })
    await dwell(page, 600, 750)

    // ── 3. Browse, narrowed with the filters. ─────────────────────────────
    await mustTap(page, page.getByRole('link', { name: 'Browse', exact: true }).first(), 'Browse')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1700, 2000)

    await mustTap(page, page.getByRole('link', { name: 'Hair', exact: true }), 'Hair filter')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1300, 1500)                       // one result, no photo

    await mustTap(page, page.getByRole('link', { name: 'Any distance', exact: true }), 'Any distance')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1500, 1800)                       // and Amelia appears

    // ── 4. Her shop. BY NAME, never .first(): the first card is Ellie
    //      Harper, and I once described this path as Nadia while it was
    //      clicking Ellie. Naming her fails loudly if she drops out. ───────
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
    await glide(page, 'Work', { overshoot: 90, ms: 900 })   // the deliberate one
    await dwell(page, 2200, 2500)                            // hold on her work
    await glide(page, 'Availability', { ms: 750 })
    await dwell(page, 1700, 2000)                            // the calendar

    // ── 6. Apply. ─────────────────────────────────────────────────────────
    await mustTap(page, page.getByRole('link', { name: /Apply for a session/i }), 'Apply')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)

    // ── 7. All seven steps. ───────────────────────────────────────────────
    // ⚠️ :not([disabled]) ON THE SLOT PICKERS. A taken slot renders as a
    // disabled button, and .first() on a disabled one hangs for 30 seconds
    // and then fails the whole run. It did, after a discovery pass had
    // booked that very slot.
    const pick = () => page.locator('ul button:not([disabled])').first()

    await dwell(page, 1700, 2000)                            // STEP 1 date
    await mustTap(page, pick(), 'date')
    await dwell(page, 1600, 1900)                            // STEP 2 time + price
    await mustTap(page, pick(), 'time')
    await dwell(page, 1500, 1800)                            // STEP 3 treatment
    await mustTap(page, pick(), 'treatment')

    await dwell(page, 1200, 1400)                            // STEP 4 note
    // ⚠️ SPELLCHECK OFF, FOR THE RECORDING ONLY. Chrome's dictionary is US, so
    // it red-underlined "coloured" — a wobbly red line under the correct
    // British spelling, in an advert, for two seconds. Suppressed here for the
    // same reason as the dev badge: it belongs to the browser doing the
    // recording, not to the product.
    const note = page.locator('textarea').first()
    await note.evaluate(el => { el.spellcheck = false })
    await note.pressSequentially('Never been coloured, happy to go lighter.', { delay: 38 })
    await dwell(page, 900, 1200)
    // "Skip" until there is something to keep; "Next" after. Both, in order.
    // ⚠️ NOT AN EXACT MATCH. Step 5's button reads "Next with 1 photo" once a
    // photo is chosen, and an anchored /^(Next|Skip)$/ silently found nothing:
    // the run carried on, skipped the last three steps and still produced a
    // video file, 79 seconds long, that simply stopped halfway through the
    // wizard. A missing click does not fail a recording — it shortens it.
    await mustTap(page, page.getByRole('button', { name: /^(Next|Skip)/ }), 'past the note')

    await dwell(page, 1700, 2000)                            // STEP 5 photos
    await mustTap(page, page.locator('button:has(img)').first(), 'a photo of her own')
    await dwell(page, 850, 1050)
    await mustTap(page, page.getByRole('button', { name: /^(Next|Skip)/ }), 'past the photos')

    await dwell(page, 1900, 2200)                            // STEP 6 consent
    const boxes = page.locator('input[type=checkbox]')
    const n = await boxes.count()
    for (let i = 0; i < n; i++) {
      await boxes.nth(i).check()                             // auto-scrolls to each
      await dwell(page, 260, 420)
    }
    await dwell(page, 700, 900)
    await mustTap(page, page.getByRole('button', { name: /Agree and continue/i }), 'Agree and continue')

    await dwell(page, 2100, 2400)                            // STEP 7 review
    await mustTap(page, page.getByRole('button', { name: /Send my application/i }), 'Send')
    await dwell(page, 2400, 2700)                            // "Application sent"

    // ── 8. The thread, accepted, ending on her line. ──────────────────────
    await page.goto(`${BASE}/messages/d0000000-0000-4000-8000-000000003000`,
      { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 3200, 3500)

    // ── 9. The closing frame. ─────────────────────────────────────────────
    await splash(page, 'model', 3000)
  },

  /** A stylist: the work -> applications arrive -> accept -> talk. ~20s */
  stylist: async page => {
    await page.goto(`${BASE}/demo?as=stylist&to=%2Favailability`, { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 1200, 1500)
    await glide(page, null, { ms: 700 })          // down to the slot editor
    await dwell(page, 2000, 2400)                        // a slot, with its price

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 2100, 2500)                        // two applications waiting

    await tap(page, page.getByText(/Accept or decline on the bookings page/i), 'to bookings')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await glide(page, 'Awaiting', { ms: 600 })
    await dwell(page, 1300, 1600)

    await tap(page, page.getByRole('button', { name: /^Accept$/ }), 'Accept')
    await dwell(page, 2300, 2700)                        // the chip flips to Confirmed

    await page.goto(`${BASE}/messages/d0000000-0000-4000-8000-000000003004`,
      { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 2800, 3200)
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
  }

  await browser.close()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
