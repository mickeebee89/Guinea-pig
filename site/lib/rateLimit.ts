/**
 * Fixed-window per-IP rate limiter, held in process memory.
 *
 * WHAT THIS IS AND IS NOT
 * On Vercel each serverless instance has its own memory, so this counter is
 * per-instance and resets on a cold start. A determined attacker spread across
 * many instances gets MAX_REQUESTS × (number of warm instances). That is a real
 * limitation, not a detail — this stops casual scripted floods and accidental
 * double-submits, and it is not a substitute for edge rate limiting.
 *
 * The durable fix is a rule in the Vercel Firewall (or a shared counter in
 * Upstash/Vercel KV). Both need account configuration rather than code, so this
 * exists to make the endpoint non-trivial to abuse in the meantime.
 *
 * Memory safety matters here: an unbounded Map keyed by attacker-controlled IPs
 * is itself a denial-of-service vector, so the table is capped and swept.
 */

const WINDOW_MS = 10 * 60_000 // 10 minutes
const MAX_TRACKED = 5_000 // hard cap on distinct IPs held in memory

/**
 * Deliberately generous. This guards a waitlist signup, so the two failure
 * modes are not symmetric: blocking a real person costs a signup, which is the
 * entire point of the page, while letting a bot through costs almost nothing —
 * the honeypot catches naive ones and a unique index on lower(email) makes
 * duplicates idempotent. Several people behind one office or salon NAT must not
 * lock each other out, so the limit sits well above any plausible human rate
 * while still turning a scripted flood from thousands per hour into dozens.
 */
const MAX_REQUESTS = 10 // per IP per window

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Drop expired buckets, then evict oldest if still over the cap. */
function sweep(now: number) {
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key)
  }
  if (buckets.size <= MAX_TRACKED) return
  // Still over cap: evict the entries closest to expiring, oldest first.
  const byExpiry = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
  for (let i = 0; i < byExpiry.length - MAX_TRACKED; i++) buckets.delete(byExpiry[i][0])
}

/**
 * Client IP as seen by Vercel. `x-forwarded-for` is a comma-separated chain and
 * the client is the first entry. Locally the header is absent, so everything
 * shares one bucket — fine for dev, and it fails closed rather than open.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the window resets. Only meaningful when `allowed` is false. */
  retryAfter: number
  remaining: number
}

export function rateLimit(key: string, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_TRACKED) sweep(now)

  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true, retryAfter: 0, remaining: MAX_REQUESTS - 1 }
  }

  existing.count += 1

  if (existing.count > MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
    }
  }

  return { allowed: true, retryAfter: 0, remaining: MAX_REQUESTS - existing.count }
}

/** Test seam — resets the in-memory table. */
export function __resetRateLimit() {
  buckets.clear()
}

export const RATE_LIMIT_CONFIG = { WINDOW_MS, MAX_REQUESTS, MAX_TRACKED } as const
