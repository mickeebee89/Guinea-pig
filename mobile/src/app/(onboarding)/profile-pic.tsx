import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as Haptics from 'expo-haptics'
import { decode } from 'base64-arraybuffer'
import { Colors } from '@/constants/Colors'
import { Button } from '@/components/Button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/auth'

export default function ProfilePicScreen() {
  const router = useRouter()
  const { session } = useAuth()
  const [imageUri, setImageUri]   = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  async function pickImage() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need access to your photo library to set a profile picture.')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })

    if (!result.canceled && result.assets[0]) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      setImageUri(result.assets[0].uri)
    }
  }

  async function takePhoto() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need camera access to take a photo.')
      return
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })

    if (!result.canceled && result.assets[0]) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      setImageUri(result.assets[0].uri)
    }
  }

  async function upload() {
    if (!imageUri || !session?.user) return
    setUploading(true)

    const fileName = `${session.user.id}/profile.jpg`

    const manipulated = await ImageManipulator.manipulateAsync(imageUri, [], { base64: true })
    const base64 = manipulated.base64!

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('profile-pics')
      .upload(fileName, decode(base64), { contentType: 'image/jpeg', upsert: true })

    if (uploadError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Upload failed', uploadError.message)
      setUploading(false)
      return
    }

    const { data: urlData } = supabase.storage
      .from('profile-pics')
      .getPublicUrl(uploadData.path)

    await supabase
      .from('users')
      .update({ profile_pic_url: urlData.publicUrl })
      .eq('id', session.user.id)

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setUploading(false)
    router.replace('/(app)')
  }

  const skip = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.replace('/(app)')
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.replace('/(app)')
  }

  return (
    <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={goBack} style={styles.backButton}>
              <Text style={styles.backButtonText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.step}>Step 1 of 1</Text>
            <Text style={styles.title}>Add a profile picture</Text>
            <Text style={styles.subtitle}>
              Help providers and models recognise you. You can always add one later in settings.
            </Text>
          </View>

          {/* Avatar */}
          <TouchableOpacity onPress={pickImage} style={styles.avatarWrapper} activeOpacity={0.85}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarEmoji}>📷</Text>
                <Text style={styles.avatarHint}>Tap to choose photo</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Photo options */}
          <View style={styles.photoOptions}>
            <TouchableOpacity onPress={pickImage} style={styles.photoOption}>
              <Text style={styles.photoOptionIcon}>🖼️</Text>
              <Text style={styles.photoOptionLabel}>Choose from library</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity onPress={takePhoto} style={styles.photoOption}>
              <Text style={styles.photoOptionIcon}>📸</Text>
              <Text style={styles.photoOptionLabel}>Take a photo</Text>
            </TouchableOpacity>
          </View>

          {/* Tips */}
          <View style={styles.tips}>
            <Text style={styles.tipsTitle}>Tips for a great photo</Text>
            {[
              'Clear, well-lit face shot',
              'No filters or heavy edits',
              'Recent — ideally taken this year',
            ].map(tip => (
              <Text key={tip} style={styles.tip}>• {tip}</Text>
            ))}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {imageUri && (
            <Button
              label="Save and continue"
              onPress={upload}
              loading={uploading}
              haptic="success"
              style={styles.saveBtn}
            />
          )}
          <Button
            label={imageUri ? 'Skip for now' : "Skip — I'll add one later"}
            onPress={skip}
            variant="ghost"
          />
        </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream, paddingHorizontal: 24 },
  content:   { flex: 1 },
  backButton: { marginBottom: 12, alignSelf: 'flex-start' },
  backButtonText: { fontSize: 17, color: Colors.rose, fontWeight: '500' },
  header: {
    paddingTop: 8,
    paddingBottom: 28,
  },
  step: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.rose,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    fontFamily: 'DancingScript_700Bold',
    fontSize: 39,
    color: Colors.warmDark,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.muted,
    lineHeight: 22,
  },
  avatarWrapper: {
    alignSelf: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: Colors.rose,
  },
  avatarPlaceholder: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.rose,
  },
  avatarEmoji: {
    fontSize: 32,
    marginBottom: 6,
  },
  avatarHint: {
    fontSize: 12,
    color: Colors.roseDark,
    fontWeight: '500',
    textAlign: 'center',
  },
  photoOptions: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 20,
  },
  photoOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  photoOptionIcon:  { fontSize: 18 },
  photoOptionLabel: { fontSize: 14, color: Colors.warmDark, fontWeight: '500' },
  divider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },
  tips: {
    backgroundColor: Colors.softPink + '40',
    borderRadius: 16,
    padding: 16,
  },
  tipsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.roseDark,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tip: {
    fontSize: 14,
    color: Colors.warmDark,
    lineHeight: 22,
    opacity: 0.8,
  },
  actions: {
    paddingBottom: 8,
    gap: 4,
  },
  saveBtn: { marginBottom: 4 },
})
