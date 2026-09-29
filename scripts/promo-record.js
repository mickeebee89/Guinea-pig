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
 * Eased scroll with a small overshoot and settle. An instant scrollTo is the
 * single biggest tell that nobody is holding the phone.
 */
async function glide(page, heading, { overshoot = 0, ms = 700 } = {}) {
  await page.evaluate(async ({ heading, overshoot, ms }) => {
    // By heading TEXT, because a nth-of-type selector silently lands on the
    // wrong section the moment a page gains one. null = scroll to the bottom.
    const el = heading
      ? [...document.querySelectorAll('h1,h2,h3')]
          .find(e => e.textContent.trim().toLowerCase().startsWith(heading.toLowerCase()))
      : null
    const to = el
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

// ── The two walkthroughs ───────────────────────────────────────────────────
const CUTS = {
  /** A model: choice -> this person -> their work -> apply. ~21s */
  model: async page => {
    await page.goto(`${BASE}/demo?as=model&to=%2Fbrowse`, { waitUntil: 'domcontentloaded' })
    await hideChrome(page)
    await dwell(page, 1900, 2200)                       // never click on load

    // ⚠️ Makeup, not Hair, and the card is taken from the list rather than
    // navigated to. Browse only surfaces stylists with open slots, so Amelia
    // — the one the stills use — is not in it. Walking to a stylist who is not
    // on the page would have been a journey the demo cannot actually make.
    await tap(page, page.getByRole('link', { name: 'Makeup', exact: true }), 'Makeup filter')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1500, 1800)

    // ⚠️ BY NAME, NOT .first(). The first card is Ellie Harper, who has no
    // photo and renders as an initial; I reported this path as "Nadia" while
    // it was clicking Ellie. Naming her makes the recording match the script,
    // and fails loudly if she ever drops out of the list.
    await tap(page, page.locator('a[href^="/stylist/"]')
      .filter({ hasText: 'Nadia Ahmed' }), 'Nadia Ahmed card')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 1100, 1400)

    await glide(page, 'Work', { overshoot: 90, ms: 800 })   // the deliberate one
    await dwell(page, 2400, 2800)                            // hold on her work

    await glide(page, 'Availability', { ms: 650 })
    await dwell(page, 1200, 1500)

    await tap(page, page.getByRole('link', { name: /Apply for a session/i }), 'Apply')
    await page.waitForLoadState('domcontentloaded')
    await hideChrome(page)
    await dwell(page, 2600, 3000)
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
