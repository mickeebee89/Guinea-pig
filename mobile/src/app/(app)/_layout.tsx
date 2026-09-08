import { View, StyleSheet } from 'react-native'
import { Stack } from 'expo-router'
import { Colors } from '@/constants/Colors'
import PatternBackground from '@/components/PatternBackground'
import SuspensionGate from '@/components/SuspensionGate'

export default function AppLayout() {
  return (
    <View style={styles.root}>
      {/* Backmost layer — faint scattered motif wallpaper behind every screen. */}
      <PatternBackground />

      {/* A suspended/banned user gets an explanation instead of the app. The DB
         blocks their actions regardless; this stops silent failures. */}
      <SuspensionGate>
      {/* ── THE STYLE WAS ON THE WRONG ELEMENT AND DID NOTHING ───────────
          `<Stack style={...}>` was a type error, and the reason it mattered is
          that Expo Router's Stack takes no `style` prop at all — React Navigation
          ignores it. So `flex: 1, backgroundColor: 'transparent'` has never been
          applied to anything since it was written.

          A View around it is where that style belongs, and it is also why this
          was invisible: the layout happened to look right without it. A type
          error that changes nothing on screen is the easiest kind to leave. */}
      <View style={styles.stack}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            marginLeft: 6,
            marginRight: 6,
            marginBottom: 6,
            borderLeftWidth: 1,
            borderRightWidth: 1,
            borderBottomWidth: 1,
            borderBottomLeftRadius: 20,
            borderBottomRightRadius: 20,
            borderColor: Colors.rose + '60',
            // Transparent so the wallpaper shows through; cards stay solid on top.
            backgroundColor: 'transparent',
            overflow: 'hidden',
          },
        }}
      />
      </View>
      </SuspensionGate>
    </View>
  )
}

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: Colors.cream },
  stack: { flex: 1, backgroundColor: 'transparent' },
})
