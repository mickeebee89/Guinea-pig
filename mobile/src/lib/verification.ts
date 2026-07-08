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

// Active £4.99/mo subscription (subscriptions.status = 'active').
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return !!data
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
