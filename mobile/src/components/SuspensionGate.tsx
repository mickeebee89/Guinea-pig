import { SUPPORT_EMAIL } from '@/constants/support'
import { useEffect, useState, ReactNode } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { usePathname, router } from 'expo-router'
import { getMySuspension, Suspension } from '@/lib/suspension'

// Wraps the authenticated app. A suspended or banned user is stopped at the door with
// a clear explanation instead of being left to hit silent failures everywhere (the DB
// policies block their actions regardless — this is the UX half of that enforcement).
//
// ── ⚠️ EXCEPT SETTINGS, AND THAT IS NOT A CONVENIENCE ─────────────────
//
// Until 24 Sep 2026 this wrapped EVERYTHING and offered a banned member one
// button: Sign out. Account deletion lives in Settings, so a banned member
// could not delete their account at all (audit item 124).
//
// In-app account deletion is an Apple 5.1.1(v) and Play requirement, not a
// courtesy, and under UK GDPR the right to erasure does not pause because
// somebody has been banned — a banned member is precisely the person most
// likely to want their data gone.
//
// ✅ AND THE DELETE PATH ACTUALLY WORKS FOR THEM, checked rather than assumed:
// the delete-account edge function identifies the caller with their own token
// and then does every write with the SERVICE ROLE, which bypasses RLS, and
// delete_account_data is SECURITY DEFINER. Nothing on that path reads
// `suspensions`. The four RESTRICTIVE policies cover sessions, messages,
// reviews and providers — not this. So the UI was the only thing stopping it,
// which is the worst kind of block: invisible, and nowhere near the rule it
// looked like it was enforcing.
//
// The notice still shows, as a screen above Settings rather than instead of it,
// so nobody has to guess why they are there.

/**
 * Routes a suspended member keeps. Settings is here for the legal reason in the
 * header above — it is not a list to extend for convenience.
 */
const STILL_REACHABLE = ['/settings']

export default function SuspensionGate({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  const pathname = usePathname()
  /**
   * ── "CHECKING" IS A COMPARISON, NOT A FLAG ───────────────────────
   *
   * It is "the answer I hold is not for the user I am looking at". Storing it
   * meant setting it true synchronously inside the effect, and meant the flag
   * and the answer could disagree for a render. Same shape as admin's
   * useLoader, which was written for the same rule.
   */
  const [answer, setAnswer] = useState<{ forUser: string | null; suspension: Suspension | null } | null>(null)
  // No user: nothing to check and nothing to gate, so this is false without a
  // write. Writing an 'answer' for the signed-out case was still a setState in
  // the effect body, which is the thing being removed.
  const checking = userId !== null && answer?.forUser !== userId
  const suspension = checking ? null : (answer?.suspension ?? null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getMySuspension().then(s => {
      if (!cancelled) setAnswer({ forUser: userId, suspension: s })
    })
    return () => { cancelled = true }
  }, [userId])

  // Don't flash the gate while we're still checking.
  if (checking) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.rose} />
      </View>
    )
  }

  if (!suspension) return <>{children}</>

  // Settings stays open so the account can still be deleted. Item 124.
  if (STILL_REACHABLE.some(r => pathname === r || pathname.startsWith(r + '/'))) {
    return <>{children}</>
  }

  return <SuspendedScreen suspension={suspension} />
}

function SuspendedScreen({ suspension }: { suspension: Suspension }) {
  const { signOut } = useAuth()
  const permanent = suspension.banned

  const untilText = (() => {
    if (permanent || !suspension.suspendedUntil) return null
    const d = new Date(suspension.suspendedUntil)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  })()

  const handleSignOut = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    await signOut()
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <View style={styles.iconRing}>
          <Ionicons name="alert-circle" size={38} color={Colors.roseDark} />
        </View>

        <Text style={styles.title}>
          {permanent ? 'Your account has been closed' : 'Your account is suspended'}
        </Text>

        <Text style={styles.body}>
          {permanent
            ? 'Your account has been permanently closed following a review of activity on the app.'
            : untilText
              ? `Your account is suspended until ${untilText}. You won't be able to apply for treatments, send messages or leave reviews until then.`
              : "Your account is temporarily suspended. You won't be able to apply for treatments, send messages or leave reviews until it's lifted."}
        </Text>

        {/* ⚠️ THE ADMIN'S MESSAGE, NOT THEIR REASON (0058, audit item 118).
            This box used to print the moderation evidence under a heading
            saying "Reason", and that evidence may name whoever reported them.
            The sentence above carries the facts and the date on its own, so
            when there is no message there is simply no box. */}
        {suspension.message ? (
          <View style={styles.messageBox}>
            <Text style={styles.messageLabel}>From the Cavy team</Text>
            <Text style={styles.messageText}>{suspension.message}</Text>
          </View>
        ) : null}

        <Text style={styles.appeal}>
          If you think this is a mistake, email {SUPPORT_EMAIL} and we’ll take another look.
        </Text>

        {/* ⚠️ THE ONLY WAY OUT OF THIS SCREEN THAT IS NOT "SIGN OUT". Deleting an
            account must never be behind a gate — see the header. Haptics because
            this is a new interaction in mobile/, matching the sign-out button
            directly below it. */}
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            router.push('/(app)/settings')
          }}
        >
          <Text style={styles.settingsBtnText}>Manage or delete your account</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={handleSignOut} activeOpacity={0.85}>
          <Text style={styles.btnText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.cream },
  safe: {
    flex: 1,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 24,
    alignItems: 'center',
    gap: 14,
    ...Shadow.card,
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: Colors.warmDark,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.muted,
    textAlign: 'center',
  },
  settingsBtn: {
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  settingsBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.roseDark,
  },
  messageBox: {
    width: '100%',
    backgroundColor: Colors.cream,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
  },
  messageLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  messageText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.warmDark,
  },
  appeal: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: 'center',
  },
  btn: {
    marginTop: 4,
    backgroundColor: Colors.rose,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  btnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.white,
  },
})
