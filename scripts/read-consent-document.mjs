/**
 * read-consent-document.mjs — print the consent document the web will render,
 * exactly as it is stored. Audit item 80.
 *
 *   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'   # this shell only
 *   node scripts/read-consent-document.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * The web consent surface is built but has no page yet — the apply flow it
 * belongs to is step 5. So there is nothing to look at, and "it renders the
 * document faithfully" would otherwise be a claim with no way to check it.
 * This prints what the database holds, so the wording can be read now and
 * compared with the screen when the page lands.
 *
 * ⚠️ IT DOES NOT RECOMPUTE THE HASH, AND NEITHER DOES THE WEBSITE.
 * content_hash is computed in Postgres by set_consent_hash(), over
 * title || body || acknowledgements::text. That last part is Postgres's own
 * jsonb rendering, which is NOT what JSON.stringify produces here — so a hash
 * recomputed in Node would differ for reasons that say nothing about whether
 * the text is intact. The only safe handling is the one both clients use:
 * read the hash, pass it through untouched, never derive it.
 *
 * Reads only. Writes nothing, and records no consent.
 */

const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
if (!KEY) {
  console.error('\nRefusing to run: SUPABASE_SERVICE_ROLE_KEY is not set in this shell.')
  console.error("  $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'\n")
  process.exit(1)
}

const URL_ =
  'https://ptluekkhiopowuyvkgnd.supabase.co/rest/v1/consent_documents' +
  '?select=id,version,title,body,content_hash,acknowledgements,is_active' +
  '&is_active=eq.true&order=version.desc&limit=1'

let res
try {
  res = await fetch(URL_, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
} catch (e) {
  console.error(`\nCould not reach the database (${e?.cause?.code ?? e?.code ?? 'network error'}).\n`)
  process.exit(1)
}

if (!res.ok) {
  console.error(`\nThe read failed (HTTP ${res.status}).`)
  if (res.status === 401) console.error('That key was not accepted.')
  console.error('')
  process.exit(1)
}

const [doc] = await res.json()

if (!doc) {
  console.error('\n⚠️ NO ACTIVE CONSENT DOCUMENT.')
  console.error('Applications would be blocked — which is the correct behaviour, and')
  console.error('the web surface fails closed on exactly this. But nobody could apply.\n')
  process.exit(1)
}

const acks = doc.acknowledgements ?? []
const ticks = acks.filter(a => a.requires_tick)
const notices = acks.filter(a => !a.requires_tick)

console.log(`\n── ACTIVE CONSENT DOCUMENT — version ${doc.version} ──\n`)
console.log(`title:  ${doc.title}`)
console.log(`hash:   ${doc.content_hash}`)
console.log(`id:     ${doc.id}\n`)
console.log('body, exactly as the page will show it:\n')
console.log(doc.body)
console.log(`\n${ticks.length} item(s) to tick:`)
for (const a of ticks) console.log(`  [ ] ${a.text ?? a.title ?? a.key}`)
if (notices.length > 0) {
  console.log(`\n${notices.length} notice(s), shown but not ticked:`)
  for (const a of notices) console.log(`   ·  ${a.text ?? a.title ?? a.key}`)
}

if (ticks.length === 0) {
  console.log('\n⚠️ Nothing to tick, so the web surface will refuse to show it and block applying.')
}

console.log('\nThe page renders the title, this body and every line above, and records')
console.log('that hash against the application. Nothing is summarised or reworded.\n')
