import { supabase } from './supabase'

// Identity verification only (users.is_verified). Use this for the "Verified" badge /
// status — it means the person passed the ID check, independent of any subscription.
export async function isIdentityVerified(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('users')
    .select('is_verified')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return !!(data as any)?.is_verified
}

// Active £4.99/mo subscription. Grants access while 'active', or while 'cancelling'
// (cancel-at-period-end) up to current_period_end — so a cancelled user keeps what
// they paid for and access lapses at period end (date-driven; there is no webhook).
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return false
  const status = (data as any).status as string
  if (status === 'active') return true
  if (status === 'cancelling') {
    const end = (data as any).current_period_end
    return !!end && new Date(end) > new Date()
  }
  return false
}

// Apply gate: a model may apply ONLY with BOTH an active subscription AND identity
// verification. (apply-session checks the two parts individually so it can route the
// model to whichever step is missing; this is the combined yes/no for simple checks.)
export async function canApply(userId: string): Promise<boolean> {
  const [subscribed, verified] = await Promise.all([
    hasActiveSubscription(userId),
    isIdentityVerified(userId),
  ])
  return subscribed && verified
}
