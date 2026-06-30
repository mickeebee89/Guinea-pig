import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/Colors'

interface Props {
  /** Re-runs the screen's load function. */
  onRetry: () => void
  /** Optional override for the headline message. */
  message?: string
  /** When true, fills/centres in the available space (full-screen use). Default true. */
  fill?: boolean
}

/**
 * Shared "couldn't load" + retry state. Render this INSTEAD of a screen's empty
 * state when a data load actually FAILED (as opposed to succeeding with no data),
 * so a failure is distinguishable from emptiness and the user can retry.
 */
export default function LoadErrorState({ onRetry, message, fill = true }: Props) {
  return (
    <View style={[styles.wrap, fill && styles.fill]}>
      <Ionicons name="cloud-offline-outline" size={40} color={Colors.muted} />
      <Text style={styles.title}>{message ?? 'Couldn’t load'}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.85}>
        <Ionicons name="refresh" size={16} color={Colors.white} />
        <Text style={styles.retryText}>Tap to retry</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  fill: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.warmDark,
    textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.roseDark,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    marginTop: 4,
  },
  retryText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
})
