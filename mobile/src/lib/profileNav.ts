import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'

// Navigating to someone's profile depends on their ROLE, and the two routes take
// ids from DIFFERENT id-spaces:
//   model    -> /(app)/model/[id]     keyed by the auth user_id
//   stylist  -> /(app)/provider/[id]  keyed by providers.id  (NOT their user_id)
//
// Passing the wrong one lands on an empty profile rather than failing loudly, so
// every avatar tap goes through here — one place to get it right, and callers
// have to say which kind of id they hold.

export function useProfileNav() {
  const router = useRouter()

  const openModel = async (userId?: string | null) => {
    if (!userId) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({ pathname: '/(app)/model/[id]' as any, params: { id: userId } })
  }

  // `providerId` must be providers.id. If you only have the stylist's user_id,
  // resolve it first (select id from providers where user_id = …).
  const openProvider = async (providerId?: string | null) => {
    if (!providerId) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({ pathname: '/(app)/provider/[id]' as any, params: { id: providerId } })
  }

  return { openModel, openProvider }
}
