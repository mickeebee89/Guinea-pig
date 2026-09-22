/**
 * DEMO MODE — the in-memory stand-in for Supabase. Audit item 69.
 *
 * Reached ONLY through the module aliases next.config.ts adds when demo mode is
 * on (see lib/demo/README.md). No real file imports this. A production build
 * has no alias, so nothing in the build references this file at all.
 *
 * It answers the query builder calls the site actually makes — flat selects,
 * eq/neq/gt/gte/lt/lte/in/is/not/or/contains/ilike, order, limit, range,
 * single/maybeSingle, exact counts, insert/update/upsert/delete — from the
 * fixture tables. The site's own query code runs unchanged against it, which
 * is the point: the pages are the real pages.
 *
 * It does NOT emulate RLS. Every query the demo screens make already filters
 * on the columns that matter; a query that leaned on RLS alone would show more
 * rows here than live. None found on 22 Sep 2026.
 */

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

export interface DemoUser {
  id: string
  email: string
  user_metadata: Record<string, unknown>
  app_metadata: Record<string, unknown>
  aud: 'authenticated'
  role: 'authenticated'
  created_at: string
}

type Result = { data: unknown; error: PgError | null; count?: number | null; status: number; statusText: string }
type PgError = { message: string; code: string; details: string | null; hint: string | null }

const err = (message: string, code = 'DEMO'): PgError => ({ message, code, details: null, hint: null })

/** Views, derived from the base tables on every read so writes show through. */
export type ViewBuilder = (t: Tables) => Row[]

export type Listener = { table?: string; event?: string; cb: (payload: { new: Row; eventType: string }) => void }

export class DemoStore {
  /** Fake realtime subscribers, told about every insert. */
  readonly listeners = new Set<Listener>()

  constructor(
    public tables: Tables,
    private views: Record<string, ViewBuilder>,
  ) {}

  inserted(table: string, row: Row) {
    for (const l of this.listeners) {
      if ((!l.table || l.table === table) && (!l.event || l.event === '*' || l.event === 'INSERT')) {
        l.cb({ new: row, eventType: 'INSERT' })
      }
    }
  }

  read(table: string): Row[] {
    const v = this.views[table]
    if (v) return v(this.tables)
    return (this.tables[table] ??= [])
  }

  isView(table: string) { return table in this.views }
}

// ── Filters ─────────────────────────────────────────────────────────────────

type Pred = (r: Row) => boolean

const cmp = (a: unknown, b: unknown): number => {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : 1
}

/** PostgREST literal → JS value. 'null' / 'true' / 'false' / numbers. */
const lit = (s: string): unknown =>
  s === 'null' ? null : s === 'true' ? true : s === 'false' ? false : s

const ilikeRe = (pattern: string) =>
  new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')

const eqLoose = (a: unknown, b: unknown) =>
  a === b || (a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b))

function opPred(col: string, op: string, value: unknown): Pred {
  switch (op) {
    case 'eq': return r => eqLoose(r[col], value)
    case 'neq': return r => !eqLoose(r[col], value)
    case 'gt': return r => r[col] != null && cmp(r[col], value) > 0
    case 'gte': return r => r[col] != null && cmp(r[col], value) >= 0
    case 'lt': return r => r[col] != null && cmp(r[col], value) < 0
    case 'lte': return r => r[col] != null && cmp(r[col], value) <= 0
    case 'is': return r => (value === null ? r[col] == null : r[col] === value)
    case 'in': {
      const list = Array.isArray(value) ? value : []
      return r => list.some(v => eqLoose(r[col], v))
    }
    case 'like':
    case 'ilike': {
      const re = ilikeRe(String(value))
      return r => r[col] != null && re.test(String(r[col]))
    }
    case 'cs': {
      const want = Array.isArray(value) ? value : [value]
      return r => Array.isArray(r[col]) && want.every(w => (r[col] as unknown[]).includes(w))
    }
    default:
      throw new Error(`demo engine: filter operator "${op}" is not implemented`)
  }
}

/** "(a,b,c)" → ['a','b','c'] */
const parseList = (s: string) => s.replace(/^\(|\)$/g, '').split(',').map(x => lit(x.trim()))

/** One `col.op.value` term of an or() string. */
function termPred(term: string): Pred {
  const m = term.match(/^([a-zA-Z0-9_]+)\.(not\.)?([a-z]+)\.(.*)$/)
  if (!m) throw new Error(`demo engine: cannot parse or() term "${term}"`)
  const [, col, not, op, raw] = m
  const value = op === 'in' ? parseList(raw) : lit(raw)
  const p = opPred(col, op, value)
  return not ? r => !p(r) : p
}

/** Split an or() string on top-level commas (not inside parentheses). */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out.map(t => t.trim()).filter(Boolean)
}

// ── The query builder ──────────────────────────────────────────────────────

type Mode = 'select' | 'insert' | 'update' | 'upsert' | 'delete'

export class DemoQuery implements PromiseLike<Result> {
  private mode: Mode = 'select'
  private cols = '*'
  private returning = false
  private preds: Pred[] = []
  private orders: { col: string; asc: boolean; nullsFirst?: boolean }[] = []
  private lim: number | null = null
  private from0 = 0
  private one: 'single' | 'maybe' | null = null
  private countExact = false
  private head = false
  private payload: Row[] = []
  private patch: Row = {}
  private conflict: string[] = ['id']

  constructor(private store: DemoStore, private table: string, private newId: () => string) {}

  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    if (this.mode !== 'select') this.returning = true
    this.cols = cols
    if (opts?.count === 'exact') this.countExact = true
    if (opts?.head) this.head = true
    return this
  }

  insert(values: Row | Row[]) {
    this.mode = 'insert'
    this.payload = Array.isArray(values) ? values : [values]
    return this
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = 'upsert'
    this.payload = Array.isArray(values) ? values : [values]
    if (opts?.onConflict) this.conflict = opts.onConflict.split(',').map(s => s.trim())
    return this
  }
  update(patch: Row) { this.mode = 'update'; this.patch = patch; return this }
  delete() { this.mode = 'delete'; return this }

  eq(c: string, v: unknown) { this.preds.push(opPred(c, 'eq', v)); return this }
  neq(c: string, v: unknown) { this.preds.push(opPred(c, 'neq', v)); return this }
  gt(c: string, v: unknown) { this.preds.push(opPred(c, 'gt', v)); return this }
  gte(c: string, v: unknown) { this.preds.push(opPred(c, 'gte', v)); return this }
  lt(c: string, v: unknown) { this.preds.push(opPred(c, 'lt', v)); return this }
  lte(c: string, v: unknown) { this.preds.push(opPred(c, 'lte', v)); return this }
  is(c: string, v: unknown) { this.preds.push(opPred(c, 'is', v)); return this }
  in(c: string, v: unknown[]) { this.preds.push(opPred(c, 'in', v)); return this }
  like(c: string, v: string) { this.preds.push(opPred(c, 'like', v)); return this }
  ilike(c: string, v: string) { this.preds.push(opPred(c, 'ilike', v)); return this }
  contains(c: string, v: unknown) { this.preds.push(opPred(c, 'cs', v)); return this }
  match(obj: Row) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this }
  not(c: string, op: string, v: unknown) {
    const value = op === 'in' && typeof v === 'string' ? parseList(v) : v
    const p = opPred(c, op, value)
    this.preds.push(r => !p(r))
    return this
  }
  or(s: string) {
    const terms = splitTop(s).map(termPred)
    this.preds.push(r => terms.some(t => t(r)))
    return this
  }
  filter(c: string, op: string, v: unknown) {
    const value = op === 'in' && typeof v === 'string' ? parseList(v) : v
    this.preds.push(opPred(c, op, value))
    return this
  }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst })
    return this
  }
  limit(n: number) { this.lim = n; return this }
  range(a: number, b: number) { this.from0 = a; this.lim = b - a + 1; return this }
  single() { this.one = 'single'; return this }
  maybeSingle() { this.one = 'maybe'; return this }
  abortSignal() { return this }
  returns() { return this }

  private project(r: Row): Row {
    if (this.cols.trim() === '*') return { ...r }
    const out: Row = {}
    for (const raw of this.cols.split(',')) {
      const c = raw.trim()
      if (!c) continue
      if (c.includes('(')) throw new Error(`demo engine: embedded select "${c}" is not implemented`)
      const [alias, col] = c.includes(':') ? c.split(':').map(s => s.trim()) : [c, c]
      out[alias] = r[col] ?? null
    }
    return out
  }

  private run(): Result {
    const ok = (data: unknown, count: number | null = null): Result =>
      ({ data, error: null, count, status: 200, statusText: 'OK' })
    const fail = (e: PgError): Result => ({ data: null, error: e, count: null, status: 400, statusText: 'Bad Request' })

    if (this.mode !== 'select' && this.store.isView(this.table)) {
      return fail(err(`demo: ${this.table} is a view and cannot be written`))
    }
    const rows = this.store.read(this.table)
    const match = (r: Row) => this.preds.every(p => p(r))

    let affected: Row[] = []
    if (this.mode === 'insert' || this.mode === 'upsert') {
      for (const v of this.payload) {
        const existing = this.mode === 'upsert'
          ? rows.find(r => this.conflict.every(k => v[k] !== undefined && eqLoose(r[k], v[k])))
          : undefined
        if (existing) { Object.assign(existing, v); affected.push(existing); continue }
        const row: Row = { id: this.newId(), created_at: new Date().toISOString(), ...v }
        rows.push(row)
        affected.push(row)
        this.store.inserted(this.table, row)
      }
    } else if (this.mode === 'update') {
      affected = rows.filter(match)
      for (const r of affected) Object.assign(r, this.patch)
    } else if (this.mode === 'delete') {
      affected = rows.filter(match)
      const keep = rows.filter(r => !match(r))
      rows.length = 0
      rows.push(...keep)
    } else {
      affected = rows.filter(match)
    }

    if (this.mode !== 'select' && !this.returning) return ok(null)

    let out = [...affected]
    for (const o of [...this.orders].reverse()) {
      out.sort((a, b) => {
        const an = a[o.col] == null, bn = b[o.col] == null
        if (an || bn) {
          if (an && bn) return 0
          const nullsFirst = o.nullsFirst ?? !o.asc
          return an ? (nullsFirst ? -1 : 1) : (nullsFirst ? 1 : -1)
        }
        const c = cmp(a[o.col], b[o.col])
        return o.asc ? c : -c
      })
    }
    const total = out.length
    out = out.slice(this.from0, this.lim == null ? undefined : this.from0 + this.lim)
    const projected = out.map(r => this.project(r))

    if (this.head) return ok(null, this.countExact ? total : null)
    const count = this.countExact ? total : null
    if (this.one === 'single') {
      return projected.length === 1
        ? ok(projected[0], count)
        : fail(err(`JSON object requested, ${projected.length} rows returned`, 'PGRST116'))
    }
    if (this.one === 'maybe') {
      return projected.length > 1
        ? fail(err(`JSON object requested, multiple (${projected.length}) rows returned`, 'PGRST116'))
        : ok(projected[0] ?? null, count)
    }
    return ok(projected, count)
  }

  then<A = Result, B = never>(
    onF?: ((v: Result) => A | PromiseLike<A>) | null,
    onR?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let res: Result
    try { res = this.run() } catch (e) {
      // A query shape this engine doesn't know is a bug in the demo, not in
      // the page. Surface it the way Supabase would, as an error result.
      console.error('[demo]', e)
      res = { data: null, error: err(e instanceof Error ? e.message : String(e)), count: null, status: 500, statusText: 'Demo engine' }
    }
    return Promise.resolve(res).then(onF, onR)
  }
}

// ── The client ─────────────────────────────────────────────────────────────

export function makeDemoClient(opts: {
  store: DemoStore
  user: DemoUser | null
  rpc?: (name: string, args: Row, store: DemoStore, user: DemoUser | null) => unknown
}) {
  const { store, user } = opts
  const newId = () =>
    (globalThis.crypto?.randomUUID?.() ?? `demo-${Math.random().toString(16).slice(2)}-${Date.now()}`)

  const listeners = store.listeners

  const refused = { data: { user: null, session: null }, error: err('Signing in, signing up and email are switched off in demo mode.') }

  return {
    from: (table: string) => new DemoQuery(store, table, newId),

    rpc: (name: string, args: Row = {}) => {
      const run = (): Result => {
        try {
          const data = opts.rpc ? opts.rpc(name, args, store, user) : null
          return { data, error: null, count: null, status: 200, statusText: 'OK' }
        } catch (e) {
          return { data: null, error: err(e instanceof Error ? e.message : String(e)), count: null, status: 400, statusText: 'Bad Request' }
        }
      }
      const p = { then: (f?: (r: Result) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(run()).then(f, r), single: () => p, maybeSingle: () => p }
      return p
    },

    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({
        data: { session: user ? { user, access_token: 'demo', refresh_token: 'demo', expires_in: 3600, token_type: 'bearer' } : null },
        error: null,
      }),
      getClaims: async () => ({ data: user ? { claims: { sub: user.id, role: 'authenticated' } } : null, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => refused,
      signUp: async () => refused,
      resend: async () => ({ data: null, error: refused.error }),
      resetPasswordForEmail: async () => ({ data: null, error: refused.error }),
      updateUser: async () => refused,
      verifyOtp: async () => refused,
      exchangeCodeForSession: async () => refused,
    },

    storage: {
      from: () => ({
        // Demo photos are site paths. Callers strip the leading slash to make
        // a storage path (lib/queries/model.ts toObjectPath), so put it back.
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map(p => ({ path: p, signedUrl: /^(https?:|\/)/.test(p) ? p : `/${p}`, error: null })), error: null }),
        createSignedUrl: async (p: string) => ({ data: { signedUrl: /^(https?:|\/)/.test(p) ? p : `/${p}` }, error: null }),
        getPublicUrl: (p: string) => ({ data: { publicUrl: p } }),
        upload: async () => ({ data: null, error: err('Uploads are switched off in demo mode.') }),
        remove: async () => ({ data: [], error: null }),
        list: async () => ({ data: [], error: null }),
      }),
    },

    functions: {
      invoke: async () => ({ data: null, error: err('Payments and edge functions are switched off in demo mode.') }),
    },

    channel: () => {
      const mine: Listener[] = []
      const ch = {
        on: (_type: string, filter: { table?: string; event?: string }, cb: Listener['cb']) => {
          const l = { table: filter?.table, event: filter?.event, cb }
          mine.push(l)
          return ch
        },
        subscribe: (cb?: (status: string) => void) => {
          for (const l of mine) listeners.add(l)
          cb?.('SUBSCRIBED')
          return ch
        },
        unsubscribe: async () => { for (const l of mine) listeners.delete(l); return 'ok' },
        _mine: mine,
      }
      return ch
    },
    removeChannel: async (ch: { _mine?: Listener[] }) => {
      for (const l of ch?._mine ?? []) listeners.delete(l)
      return 'ok'
    },
    removeAllChannels: async () => { listeners.clear(); return [] },
  }
}
