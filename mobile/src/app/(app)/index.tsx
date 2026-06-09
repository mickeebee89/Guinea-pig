import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'

export default function HomeScreen() {
  const { signOut } = useAuth()

  const handleSignOut = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    signOut()
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <Text style={styles.logo}>🐾</Text>
          <Text style={styles.title}>You're in!</Text>
          <Text style={styles.subtitle}>
            The main app is coming soon.{'\n'}
            Auth flow complete ✓
          </Text>
          <TouchableOpacity onPress={handleSignOut} style={styles.signOut}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  safe:      { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo:     { fontSize: 56, marginBottom: 16 },
  title:    { fontSize: 28, fontWeight: '800', color: Colors.warmDark, marginBottom: 10 },
  subtitle: { fontSize: 16, color: Colors.muted, textAlign: 'center', lineHeight: 24 },
  signOut: {
    marginTop: 40,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  signOutText: { fontSize: 15, color: Colors.roseDark, fontWeight: '600' },
})
