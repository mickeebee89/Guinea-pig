# Demo seed data (store screenshots only)

Creates believable stylists, models, bookings, reviews and a chat so the store
screenshots don't show empty screens.

> ⚠️ **This writes to the LIVE Supabase project.** There is no staging
> environment. Seeded stylists are published and **genuinely bookable**, so they
> must be removed before launch. Teardown is one command and is designed to be
> run without thinking about it.

## Photos

Drop your AI-generated images into these folders. Any `.jpg` / `.jpeg` / `.png`
/ `.webp` works; files are used in sorted filename order. Missing folders are
skipped with a warning rather than failing the run.

```
seed/photos/
  stylists/    5 profile photos  (one per stylist, in name order)
  models/      4 profile photos  (one per model, in name order)
  portfolio/   ~20 work photos   (hair/nails/lashes/brows/makeup — spread round-robin, 4 each)
  gallery/     ~12 model photos  (spread round-robin, 3 each)
```

The stylist/model order the script uses:

| stylists/ | models/ |
|---|---|
| 1 Amelia Rowe — hair | 1 Sophie Hall |
| 2 Priya Shah — lashes | 2 Leah Bennett |
| 3 Chloe Baxter — nails | 3 Amara Nwosu |
| 4 Nadia Ahmed — makeup | 4 Jess Whitmore |
| 5 Grace Okafor — brows | |

**Use AI-generated or properly licensed faces.** Don't use photos of real people
without a model release — this app's whole premise is "be a practice model", and
someone finding their face on the listing would be a genuine problem. Note that
permissive stock licences (e.g. Unsplash) generally do **not** grant likeness
rights for identifiable people.

`seed/photos/` is gitignored — the images never enter the repo.

## Running

The service-role key is read from the environment so it never touches a file.
In PowerShell it lives only in that shell session:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
```

```powershell
node seed/seed.mjs
```

Then sign in as any demo account — password is printed at the end.

## Teardown — run before launch

```powershell
node seed/teardown.mjs --dry-run   # list what would go
node seed/teardown.mjs             # delete it
```

Removes the accounts and everything they own: storage objects across all four
buckets, providers, treatments, availability, portfolio, model photos and
attributes, sessions, messages, reviews, notifications, and the `public.users`
row (which does **not** cascade from `auth.users`), then the auth user itself.
It re-checks afterwards and tells you if anything survived.

### Why teardown can't hit a real account

Every seeded account is created on **`@seed.guineapig.invalid`**. `.invalid` is
a reserved TLD (RFC 2606) that can never be registered and can't receive mail —
so no real user can ever hold one, by accident or otherwise. Teardown matches on
that suffix alone, and **refuses to run** if the suffix is ever edited to
something that isn't a reserved test domain.

## After seeding

Take the screenshots, then run teardown. Don't leave it to memory — a fake
stylist with live availability can be booked by a real person.
