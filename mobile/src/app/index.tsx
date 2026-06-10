import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Platform,
  Image,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'

const LOGO_URI = 'https://res.cloudinary.com/dzbazlq1o/image/upload/f_auto,q_auto/54340_ia8jsd'

export default function WelcomeScreen() {
  const router = useRouter()
  const { setRole } = useAuth()
  const { width } = useWindowDimensions()
  const wide = width >= 600

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
        <View style={styles.hero}>
          <Image source={{ uri: LOGO_URI }} style={styles.logo} resizeMode="contain" />
          <Text style={styles.appName}>Guinea Pig</Text>
          <Text style={styles.tagline}>Someone's gotta be the guinea pig</Text>
        </View>

        <View style={styles.cards}>
          <Text style={styles.prompt}>I want to…</Text>
          <View style={[styles.cardsInner, wide && styles.cardsInnerRow]}>
            <RoleCard
              emoji="✂️"
              title="Provider"
              subtitle="I'm learning beauty and want to practise on models"
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
          <Text style={styles.footerText}>Already have an account? </Text>
          <Text style={styles.loginLink} onPress={goLogin}>Log in</Text>
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
      activeOpacity={0.85}
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
  logo: {
    width: 80,
    height: 80,
    borderRadius: 20,
    marginBottom: 16,
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
    fontStyle: 'italic',
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
    borderRadius: 16,
    padding: 16,
    backgroundColor: Colors.roseDark,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  cardWide: {
    flex: 1,
  },
  cardEmoji: {
    fontSize: 24,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 16,
  },
  chevron: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '300',
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
