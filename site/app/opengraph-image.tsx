import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { SITE_TAGLINE } from '@/lib/site'

export const alt = 'Cavy — hair and beauty models. Be the guinea pig, get the glow.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * The social preview card. Without one, every share of this link on Instagram,
 * TikTok, WhatsApp or a text message renders as a bare title and URL — which
 * for a pre-launch waitlist is most of the traffic.
 *
 * Generated at build time, so the filesystem read is fine and the PNG is
 * static. The logo is a 40KB copy resized from the 332KB original, because the
 * source has to be inlined as a data URI here and the original would bloat the
 * route for no visible gain at 1200x630.
 *
 * FONTS: Satori (which renders this) cannot synthesise a bold weight — without
 * real font data it silently ignores fontWeight and draws thin, which made an
 * early version of this card read as an airy luxury brand rather than a chunky
 * playful one. So the actual faces are shipped: Fredoka 600 for the wordmark
 * and Quicksand for everything else, matching Fonts in
 * mobile/src/constants/Colors.ts. They come from @fontsource as .woff, read off
 * disk at build time — Satori supports woff but NOT woff2, and next/font hands
 * its files to the CSS pipeline rather than to us.
 */
const fontFile = (pkg: string, file: string) =>
  readFileSync(join(process.cwd(), 'node_modules', '@fontsource', pkg, 'files', file))

export default async function Image() {
  const logo = readFileSync(join(process.cwd(), 'app', 'og-logo.png'))
  const logoSrc = `data:image/png;base64,${logo.toString('base64')}`

  const fredoka600 = fontFile('fredoka', 'fredoka-latin-600-normal.woff')
  const quicksand500 = fontFile('quicksand', 'quicksand-latin-500-normal.woff')
  const quicksand700 = fontFile('quicksand', 'quicksand-latin-700-normal.woff')

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FFF7FA',
          // Matches PinkGradient in mobile/src/constants/Colors.ts
          backgroundImage: 'linear-gradient(180deg, #FFE3EF 0%, #FFF7FA 62%)',
          fontFamily: 'Quicksand',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 260,
            height: 260,
            borderRadius: 999,
            backgroundColor: '#FFE3EF',
            border: '3px solid #F6E1EA',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={168} height={168} alt="" />
        </div>

        <div
          style={{
            marginTop: 22,
            fontFamily: 'Fredoka',
            fontSize: 96,
            letterSpacing: -1,
            color: '#DB4B86',
          }}
        >
          Cavy
        </div>

        <div style={{ marginTop: 4, fontSize: 36, fontWeight: 700, color: '#2B2531' }}>
          {SITE_TAGLINE}
        </div>

        <div
          style={{
            marginTop: 22,
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: '#6E6675',
          }}
        >
          Hair &amp; beauty models · UK
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Fredoka', data: fredoka600, weight: 600, style: 'normal' },
        { name: 'Quicksand', data: quicksand500, weight: 500, style: 'normal' },
        { name: 'Quicksand', data: quicksand700, weight: 700, style: 'normal' },
      ],
    },
  )
}
