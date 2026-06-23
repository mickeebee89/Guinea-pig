import { View } from 'react-native'
import { Colors } from '@/constants/Colors'

export default function ScreenDecor() {
  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -80,
          right: -70,
          width: 220,
          height: 220,
          borderRadius: 110,
          backgroundColor: Colors.rose,
          opacity: 0.09,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: -60,
          left: -60,
          width: 170,
          height: 170,
          borderRadius: 85,
          backgroundColor: Colors.softPink,
          opacity: 0.13,
        }}
      />
    </>
  )
}
