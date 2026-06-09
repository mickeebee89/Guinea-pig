import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Colors } from '@/constants/Colors'
import { Button } from '@/components/Button'
import { useAuth } from '@/context/auth'

export default function WelcomeScreen() {
  const router = useRouter()
  const { setRole } = useAuth()

  const pickRole = async (role: 'provider' | 'model') => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setRole(role)
    router.push({ pathname: '/(auth)/signup', params: { role } })
  }

  const goLogin = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push('/(auth)/login')
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.logoMark}>
            <Text style={styles.logoEmoji}>🐾</Text>
          </View>
          <Text style={styles.appName}>Guinea Pig</Text>
          <Text style={styles.tagline}>
            Connect with beauty learners{'\n'}for free practice sessions
          </Text>
        </View>

        {/* Role selection */}
        <View style={styles.cards}>
          <Text style={styles.prompt}>I am a…</Text>

          <RoleCard
            emoji="✂️"
            title="Provider"
            subtitle="I'm learning beauty and want to practise on models"
            onPress={() => pickRole('provider')}
            primary
          />

          <RoleCard
            emoji="💆"
            title="Model"
            subtitle="I'd love free treatments and don't mind being a practice client"
            onPress={() => pickRole('model')}
          />
        </View>

        {/* Login link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Text style={styles.loginLink} onPress={goLogin}>
            Log in
          </Text>
        </View>
      </SafeAreaView>
    </View>
  )
}

function RoleCard({
  emoji,
  title,
  subtitle,
  onPress,
  primary = false,
}: {
  emoji: string
  title: string
  subtitle: string
  onPress: () => void
  primary?: boolean
}) {
  return (
    <View
      style={[styles.card, primary ? styles.cardPrimary : styles.cardSecondary]}
      onTouchEnd={onPress}
    >
      <View style={styles.cardInner}>
        <Text style={styles.cardEmoji}>{emoji}</Text>
        <View style={styles.cardText}>
          <Text style={[styles.cardTitle, primary && styles.cardTitlePrimary]}>
            {title}
          </Text>
          <Text style={[styles.cardSubtitle, primary && styles.cardSubtitlePrimary]}>
            {subtitle}
          </Text>
        </View>
        <Text style={[styles.chevron, primary && styles.chevronPrimary]}>›</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  safe: {
    flex: 1,
    paddingHorizontal: 24,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Platform.OS === 'android' ? 40 : 20,
  },
  logoMark: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.roseDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  logoEmoji: {
    fontSize: 36,
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 15,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 22,
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
  card: {
    borderRadius: 20,
    padding: 20,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardPrimary: {
    backgroundColor: Colors.roseDark,
    shadowColor: Colors.roseDark,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  cardSecondary: {
    backgroundColor: Colors.white,
    shadowColor: Colors.warmDark,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardEmoji: {
    fontSize: 28,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.warmDark,
    marginBottom: 2,
  },
  cardTitlePrimary: {
    color: Colors.white,
  },
  cardSubtitle: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
  },
  cardSubtitlePrimary: {
    color: 'rgba(255,255,255,0.75)',
  },
  chevron: {
    fontSize: 24,
    color: Colors.muted,
    fontWeight: '300',
  },
  chevronPrimary: {
    color: 'rgba(255,255,255,0.6)',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: Platform.OS === 'android' ? 24 : 8,
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
})
