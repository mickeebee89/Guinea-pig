import { Text, TouchableOpacity, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius } from '@/constants/Colors'

/**
 * The one safety control. One word, one shape, every surface, both clients.
 *
 * ── WHY THIS REPLACED THREE DOTS ──────────────────────────────────────────
 * Report and block used to sit behind a bare `ellipsis-horizontal` — roseDark
 * on the model profile, WHITE OVER THE BANNER PHOTOGRAPH on the stylist
 * profile, and `ellipsis-vertical` in chat. Three surfaces, three appearances,
 * no label on any of them.
 *
 * Micky could not find it on a profile the day it was built, and asked where it
 * was. That is the test result: if the person who commissioned it cannot see it
 * while calm, someone frightened will not see it either.
 *
 * ── WHY accessibilityLabel WAS NOT ENOUGH ─────────────────────────────────
 * All three already carried `accessibilityLabel="Safety options"`, and it is
 * worth being precise about what that bought: a screen-reader user could find
 * the control, and NOBODY ELSE COULD. An accessibility label is not a visible
 * label. It is announced to assistive technology and rendered to no one — so it
 * made the control reachable for a minority of users and left it invisible to
 * everyone else, while reading in code review like the labelling problem had
 * been dealt with.
 *
 * The label has to be on the screen. Hence a pill with the word on it, and the
 * accessibilityLabel kept as well — the two are not alternatives.
 *
 * ── WHY "SAFETY" ──────────────────────────────────────────────────────────
 * Not "Report": reporting and blocking are separate actions and this leads to
 * both, so naming it after one of them hides the other. Not "More" or "Options":
 * true of any menu and a reason to skip past it. "Safety" says what the thing is
 * for in the word someone in trouble is already thinking in.
 *
 * The same word is on the web (`site/components/SafetyMenu.tsx`). If a new
 * surface needs this control, it uses this component and that word — see
 * docs/safety-surface.md.
 */
export default function SafetyButton({
  onPress,
  name,
  onBanner = false,
}: {
  onPress: () => void
  /** Whose profile this is, for the screen-reader label only. */
  name?: string
  /** Over a photo: needs its own opaque background rather than a tint. */
  onBanner?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.pill, onBanner && styles.onBanner]}
      onPress={async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress()
      }}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={name ? `Safety options for ${name}` : 'Safety options'}
      accessibilityHint="Report or block this person"
      // 44pt is the minimum comfortable touch target, and this is the last
      // control anyone should have to tap twice.
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <View style={styles.row}>
        <Ionicons name="flag-outline" size={14} color={Colors.roseDark} />
        <Text style={styles.label}>Safety</Text>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill ?? 999,
    backgroundColor: Colors.softPink,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
  },
  // Over a banner photo the tint alone cannot be relied on for contrast.
  onBanner: {
    backgroundColor: Colors.white,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.roseDark,
  },
})
