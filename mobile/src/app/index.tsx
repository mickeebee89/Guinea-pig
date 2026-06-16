import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'

const LOGO_URI = 'https://res.cloudinary.com/dzbazlq1o/image/upload/f_auto,q_auto/54340_ia8jsd'

export default function WelcomeScreen() {
  const router = useRouter()
  const { setRole, session, signOut } = useAuth()
  const { width } = useWindowDimensions()
  const wide = width >= 600
  const logoSize = Math.min(width * 0.62, 280)

  const pickRole = async (role: 'provider' | 'model') => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setRole(role)
    router.push({ pathname: '/(auth)/signup', params: { role } })
  }

  const goLogin = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push('/(auth)/login')
  }

  const handleSignOut = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await signOut()
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Decorative background circles */}
      <View style={styles.decorTop} />
      <View style={styles.decorBottom} />

      <View style={styles.hero}>
        <View style={[styles.logoRing, { width: logoSize + 16, height: logoSize + 16, borderRadius: (logoSize + 16) / 2 }]}>
          <Image
            source={{ uri: LOGO_URI }}
            style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
            resizeMode="cover"
          />
        </View>
        <Text style={styles.tagline}>Someone's gotta be the guinea pig</Text>
      </View>

      <View style={styles.cards}>
        <Text style={styles.prompt}>I want to…</Text>
        <View style={[styles.cardsInner, wide && styles.cardsInnerRow]}>
          <RoleCard
            emoji="✨"
            title="Stylist"
            subtitle="I offer beauty treatments and want to build my portfolio"
            onPress={() => pickRole('provider')}
            wide={wide}
          />
          <RoleCard
            emoji="💆"
            title="Model"
            subtitle="I'd love free treatments and don't mind being a practice client"
            onPress={() => pickRole('model')}
            wide={wide}
          />
        </View>
      </View>

      <View style={styles.footer}>
        {session ? (
          <>
            <Text style={styles.footerText}>Signed in — </Text>
            <TouchableOpacity onPress={handleSignOut}>
              <Text style={styles.signOutLink}>Sign out</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={goLogin}>
              <Text style={styles.loginLink}>Log in</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

function RoleCard({
  emoji,
  title,
  subtitle,
  onPress,
  wide,
}: {
  emoji: string
  title: string
  subtitle: string
  onPress: () => void
  wide?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.card, wide && styles.cardWide]}
      onPress={onPress}
      activeOpacity={0.82}
    >
      <Text style={styles.cardEmoji}>{emoji}</Text>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFF5F7',
    paddingHorizontal: 24,
    overflow: 'hidden',
  },
  decorTop: {
    position: 'absolute',
    top: -90,
    right: -70,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: Colors.softPink,
    opacity: 0.45,
  },
  decorBottom: {
    position: 'absolute',
    bottom: -110,
    left: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: Colors.rose,
    opacity: 0.18,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  logoRing: {
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.rose,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 10,
  },
  tagline: {
    fontSize: 16,
    fontStyle: 'italic',
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  cards: {
    paddingBottom: 16,
    gap: 12,
  },
  prompt: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  cardsInner: {
    gap: 12,
  },
  cardsInnerRow: {
    flexDirection: 'row',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    padding: 18,
    backgroundColor: Colors.rose,
    shadowColor: Colors.rose,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 6,
  },
  cardWide: {
    flex: 1,
  },
  cardEmoji: {
    fontSize: 26,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.white,
    marginBottom: 3,
  },
  cardSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.82)',
    lineHeight: 17,
  },
  chevron: {
    fontSize: 24,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '300',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 8,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 14,
    color: Colors.muted,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.roseDark,
  },
  signOutLink: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.rose,
  },
})
