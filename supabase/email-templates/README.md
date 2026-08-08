# Auth email templates

Five templates for **Supabase → Authentication → Email Templates**.

**Do not edit the `.html` files.** They are generated. Edit `build.mjs` and re-run:

```bash
node supabase/email-templates/build.mjs
```

One shell, five bodies — so the palette, footer and legal line are defined once.
Five hand-maintained files would diverge within a couple of edits, which is the
failure this project has hit repeatedly (`location` vs `location_text`, the root
Expo configs, hardcoded consent copy vs an unrendered document).

| File | Supabase template |
|---|---|
| `confirm-signup.html` | Confirm signup |
| `reset-password.html` | Reset password |
| `magic-link.html` | Magic Link |
| `change-email.html` | Change Email Address |
| `invite.html` | Invite user |

## Constraints, all deliberate

- **No images at all.** Image blocking is on by default in many clients, so an
  image-led email arrives as a broken box. It also avoids the image-heavy,
  text-light ratio spam filters score against — which matters most on a domain
  with no sending reputation.
- **Table layout, inline styles.** Outlook ignores `<style>` blocks and most
  modern CSS. No classes, no media queries — the 600px table degrades to full
  width on mobile on its own.
- **One button, one link.** Multiple CTAs read as marketing.
- **The raw URL repeated as text** under the button: some clients strip buttons,
  and a visible link is a trust signal.
- **A real postal identity in the footer.** Its absence is a spam signal.
- **Under 102KB**, so Gmail does not clip them. Currently ~3.9KB each.

## `{{ .ConfirmationURL }}`

Supabase's token. **Leave it exactly as written**, in both places — the button
`href` and the plain-text fallback. It resolves to the `redirectTo` the client
passed, falling back to the project Site URL.

Both clients pass it explicitly (`lib/signup.ts` on web, `SignupScreen.tsx` and
`ForgotPasswordScreen.tsx` on mobile), so the fallback should never be reached.

## Not yet done

- **Sender identity.** Resend is verified for `no-reply@guineapigapp.co.uk`. The
  emails now say Cavy and link to cavybeauty.com while arriving from the old
  domain, which is a mismatch a recipient can see and a signal a spam filter can
  score. Verifying `cavybeauty.com` in Resend and moving the sender is its own
  task — DNS records, then the Supabase SMTP setting.
- **Nothing here is tested against a real client.** The constraints are sound
  but Outlook, Gmail and Apple Mail each have their own opinions. Send one of
  each to a real inbox before launch.
