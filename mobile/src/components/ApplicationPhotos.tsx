import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts } from '@/constants/Colors'

// Photos the model attached when applying ("Share photos to help the stylist
// prepare"). Shown to the STYLIST on the application and on the confirmed booking.
//
// `photos` must already be SIGNED urls — the model-photos bucket is private, so a
// raw stored path renders blank. Callers sign in bulk at load time via
// signModelPhotos (see lib/photoUrls.ts).
//
// Renders nothing at all when there are no photos: most applications have none,
// and an empty label would just be noise on every card.

export default function ApplicationPhotos({
  photos,
  onPress,
}: {
  photos: string[]
  onPress: (uri: string) => void
}) {
  if (!photos || photos.length === 0) return null

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        {photos.length} photo{photos.length === 1 ? '' : 's'} from the model
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {photos.map((uri, i) => (
          <TouchableOpacity
            key={`${uri}-${i}`}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              onPress(uri)
            }}
            activeOpacity={0.85}
          >
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap:  { marginTop: 10 },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  row:   { gap: 6, paddingRight: 4 },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: Colors.inputBg,
  },
})
