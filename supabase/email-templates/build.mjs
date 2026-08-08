/**
 * build.mjs — generate the five Supabase auth email templates.
 *
 *   node supabase/email-templates/build.mjs
 *
 * ONE SHELL, FIVE BODIES. The chrome — palette, layout, footer, legal line —
 * is defined once here. Five hand-maintained HTML files would diverge within a
 * couple of edits, which is the failure this project has now hit three times
 * (location vs location_text, the root Expo configs, hardcoded consent copy vs
 * an unrendered document).
 *
 * To rebrand or change the footer: edit this file, re-run, paste the outputs.
 *
 * DESIGN CONSTRAINTS, all deliberate:
 *   * Table-based layout with inline styles — Outlook ignores <style> blocks
 *     and most modern CSS.
 *   * NO IMAGES AT ALL. Image-blocking is on by default in many clients, so an
 *     image-led email arrives as a broken box. It also avoids the
 *     image-heavy/text-light ratio that spam filters score against — which
 *     matters most on a domain with no sending reputation yet.
 *   * One button, one link. Multiple CTAs read as marketing.
 *   * The raw URL is repeated as plain text below the button, because some
 *     clients strip buttons and because a visible link is a trust signal.
 *   * A real postal identity in the footer. Its absence is a spam signal.
 *
 * {{ .ConfirmationURL }} IS SUPABASE'S TOKEN — leave it exactly as written.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.dirname(fileURLToPath(import.meta.url))

// Canonical palette — mobile/src/constants/Colors.ts.
// NOT the gold from the old templates; that predates the pink theme.
const C = {
  rose:     '#DB4B86',
  roseDark: '#C23A71',
  softPink: '#FFE3EF',
  cream:    '#FFF7FA',
  warmDark: '#2B2531',
  muted:    '#6E6675',
  border:   '#F6E1EA',
  white:    '#FFFFFF',
}

const SITE = 'https://cavybeauty.com'
const SUPPORT = 'support@guineapigapp.co.uk'

const shell = ({ preheader, heading, body, cta, afterCta }) => `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${heading}</title>
</head>
<body style="margin:0; padding:0; background-color:${C.cream}; -webkit-text-size-adjust:100%;">

<!-- Preheader: the grey line clients show next to the subject. Hidden in the body. -->
<div style="display:none; font-size:1px; color:${C.cream}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${preheader}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.cream};">
<tr>
<td align="center" style="padding:32px 16px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;">

<!-- Wordmark, as text. No image to block. -->
<tr>
<td align="center" style="padding:0 0 24px 0;">
<span style="font-family:Georgia,'Times New Roman',serif; font-size:30px; font-weight:bold; color:${C.rose}; letter-spacing:-0.5px;">Cavy</span>
</td>
</tr>

<tr>
<td style="background-color:${C.white}; border:1px solid ${C.border}; border-radius:16px; padding:36px 32px;">

<h1 style="margin:0 0 16px 0; font-family:Helvetica,Arial,sans-serif; font-size:22px; line-height:30px; font-weight:bold; color:${C.warmDark};">${heading}</h1>

${body}

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 20px 0;">
<tr>
<td align="center" bgcolor="${C.rose}" style="border-radius:999px;">
<a href="{{ .ConfirmationURL }}" style="display:inline-block; padding:14px 32px; font-family:Helvetica,Arial,sans-serif; font-size:16px; font-weight:bold; color:${C.white}; text-decoration:none; border-radius:999px;">${cta}</a>
</td>
</tr>
</table>

<p style="margin:0 0 6px 0; font-family:Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:${C.muted};">Or paste this into your browser:</p>
<p style="margin:0 0 20px 0; font-family:Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:${C.rose}; word-break:break-all;">{{ .ConfirmationURL }}</p>

${afterCta}

</td>
</tr>

<tr>
<td style="padding:24px 8px 0 8px;">
<p style="margin:0 0 10px 0; font-family:Helvetica,Arial,sans-serif; font-size:12px; line-height:18px; color:${C.muted};">
Questions? Reply to this email or write to <a href="mailto:${SUPPORT}" style="color:${C.roseDark};">${SUPPORT}</a>.
</p>
<p style="margin:0 0 10px 0; font-family:Helvetica,Arial,sans-serif; font-size:12px; line-height:18px; color:${C.muted};">
<a href="${SITE}/terms" style="color:${C.muted};">Terms</a> &nbsp;·&nbsp;
<a href="${SITE}/privacy" style="color:${C.muted};">Privacy</a> &nbsp;·&nbsp;
<a href="${SITE}/community" style="color:${C.muted};">Community Guidelines</a>
</p>
<p style="margin:0; font-family:Helvetica,Arial,sans-serif; font-size:11px; line-height:17px; color:${C.muted};">
Cavy is a trading name of Guinea Pig App Ltd, registered in England &amp; Wales, company no. 17272796.<br>
75 Aintree Road, Chatham, Kent, ME5 8PQ.
</p>
</td>
</tr>

</table>
</td>
</tr>
</table>

</body>
</html>
`

const p = (text) =>
  `<p style="margin:0 0 14px 0; font-family:Helvetica,Arial,sans-serif; font-size:15px; line-height:24px; color:${C.warmDark};">${text}</p>`

const note = (text) =>
  `<p style="margin:0; padding:14px 16px; background-color:${C.softPink}; border-radius:10px; font-family:Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:${C.warmDark};">${text}</p>`

const TEMPLATES = {
  'confirm-signup': shell({
    preheader: 'Confirm your email to finish setting up your Cavy account.',
    heading: 'Confirm your email',
    body:
      p('Welcome to Cavy — the place where hair and beauty stylists building their portfolios meet people who want the treatment.') +
      p('Confirm your email address and your account is ready.'),
    cta: 'Confirm my email',
    afterCta: note('If you didn’t create a Cavy account, you can ignore this email — nothing will be set up.'),
  }),

  'reset-password': shell({
    preheader: 'Choose a new password for your Cavy account.',
    heading: 'Reset your password',
    body:
      p('We received a request to reset the password on your Cavy account.') +
      p('Use the button below to choose a new one. The link works once, and expires after a short time.'),
    cta: 'Choose a new password',
    afterCta: note('If you didn’t ask for this, you can safely ignore it — your password stays as it is, and nobody has access to your account.'),
  }),

  'magic-link': shell({
    preheader: 'Your one-time sign-in link for Cavy.',
    heading: 'Your sign-in link',
    body:
      p('Use the button below to sign in to Cavy. No password needed.') +
      p('The link works once, and expires after a short time.'),
    cta: 'Sign in to Cavy',
    afterCta: note('If you didn’t ask to sign in, ignore this email. Nobody can use this link but you.'),
  }),

  'change-email': shell({
    preheader: 'Confirm your new email address for Cavy.',
    heading: 'Confirm your new email address',
    body:
      p('You asked to change the email address on your Cavy account.') +
      p('Confirm the new address below. Until you do, your account keeps using the old one.'),
    cta: 'Confirm new address',
    afterCta: note('If you didn’t request this change, ignore this email and contact us — your account keeps its current address.'),
  }),

  invite: shell({
    preheader: 'You’ve been invited to join Cavy.',
    heading: 'You’ve been invited to Cavy',
    body:
      p('Cavy connects hair and beauty stylists building their portfolios with people who want treatments free or discounted.') +
      p('Accept the invitation below to set up your account.'),
    cta: 'Accept invitation',
    afterCta: note('If you weren’t expecting this, you can ignore it — no account is created until you accept.'),
  }),
}

mkdirSync(OUT, { recursive: true })
for (const [name, html] of Object.entries(TEMPLATES)) {
  const file = path.join(OUT, `${name}.html`)
  writeFileSync(file, html)
  const bytes = Buffer.byteLength(html)
  const warn = bytes > 102400 ? '  ⚠ over 102KB — Gmail will clip it' : ''
  console.log(`  ${name.padEnd(16)} ${String(bytes).padStart(5)} bytes${warn}`)
}
console.log('\nPaste each into Supabase → Authentication → Email Templates.')
