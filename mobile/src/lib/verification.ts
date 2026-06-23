import { supabase } from './supabase'

export async function isModelVerified(userId: string): Promise<boolean> {
  const [{ data: subData, error: subErr }, { data: userData, error: userErr }] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('users')
      .select('is_verified')
      .eq('id', userId)
      .maybeSingle(),
  ])

  if (subErr)  throw subErr
  if (userErr) throw userErr

  return !!subData || !!(userData as any)?.is_verified
}
