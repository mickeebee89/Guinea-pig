// Holds credentials in memory only between signup and email confirmation.
// Cleared immediately after first use.
let pending: { email: string; password: string } | null = null

export const pendingAuth = {
  set(email: string, password: string) { pending = { email, password } },
  get() { return pending },
  clear() { pending = null },
}
