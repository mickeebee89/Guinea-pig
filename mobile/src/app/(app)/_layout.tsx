import { View, StyleSheet } from 'react-native'
import { Stack } from 'expo-router'
import { Colors } from '@/constants/Colors'
import PatternBackground from '@/components/PatternBackground'

export default function AppLayout() {
  return (
    <View style={styles.root}>
      {/* Backmost layer — faint scattered motif wallpaper behind every screen. */}
      <PatternBackground />

      <Stack
        style={styles.stack}
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
  )
}

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: Colors.cream },
  stack: { flex: 1, backgroundColor: 'transparent' },
})
