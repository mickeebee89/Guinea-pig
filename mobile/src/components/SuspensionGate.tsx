import { useEffect, useState, ReactNode } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { getMySuspension, Suspension } from '@/lib/suspension'

// Wraps the authenticated app. A suspended or banned user is stopped at the door with
// a clear explanation instead of being left to hit silent failures everywhere (the DB
// policies block their actions regardless — this is the UX half of that enforcement).

export default function SuspensionGate({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [checking, setChecking] = useState(true)
  const [suspension, setSuspension] = useState<Suspension | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!session?.user?.id) { setSuspension(null); setChecking(false); return }
    setChecking(true)
    getMySuspension().then(s => {
      if (!cancelled) { setSuspension(s); setChecking(false) }
    })
    return () => { cancelled = true }
  }, [session?.user?.id])

  // Don't flash the gate while we're still checking.
  if (checking) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.rose} />
      </View>
    )
  }

  if (!suspension) return <>{children}</>

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

        {suspension.reason ? (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonLabel}>Reason</Text>
            <Text style={styles.reasonText}>{suspension.reason}</Text>
          </View>
        ) : null}

        <Text style={styles.appeal}>
          If you think this is a mistake, email support@guineapigapp.co.uk and we'll take another look.
        </Text>

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
  reasonBox: {
    width: '100%',
    backgroundColor: Colors.cream,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
  },
  reasonLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  reasonText: {
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
