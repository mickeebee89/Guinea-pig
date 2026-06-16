import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  TextInput,
  Modal,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { decode } from 'base64-arraybuffer'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

// ── Constants ─────────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window')
const CELL_GAP  = 8
const CELL_SIZE = Math.floor((SCREEN_W - 40 - CELL_GAP * 2) / 3)
const MAX_PHOTOS = 6

// ── Types ─────────────────────────────────────────────────────────────────────

type UserProfile = {
  first_name: string
  last_initial: string | null
  profile_pic_url: string | null
  is_verified: boolean | null
  subscription_status: string | null
}

type GalleryPhoto = {
  id: string
  photoUrl: string
  caption: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function subscriptionLabel(status: string | null | undefined): { text: string; color: string; bg: string } {
  switch (status) {
    case 'premium': return { text: '✨ Premium', color: Colors.roseDark, bg: Colors.softPink + '50' }
    case 'pro':     return { text: '🌟 Pro',     color: '#7B5EA7',        bg: '#7B5EA7' + '20' }
    default:        return { text: 'Free Plan',  color: Colors.muted,     bg: Colors.inputBg }
  }
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ModelProfileScreen() {
  const router   = useRouter()
  const { session, signOut } = useAuth()
  const insets   = useSafeAreaInsets()
  const userId   = session?.user?.id

  const [profile,          setProfile]          = useState<UserProfile | null>(null)
  const [photos,           setPhotos]           = useState<GalleryPhoto[]>([])
  const [loading,          setLoading]          = useState(true)
  const [uploading,        setUploading]        = useState(false)
  const [addingPhotos,     setAddingPhotos]     = useState(false)
  const [optionsPhotoId,   setOptionsPhotoId]   = useState<string | null>(null)
  const [captionPhotoId,   setCaptionPhotoId]   = useState<string | null>(null)
  const [captionText,      setCaptionText]      = useState('')
  const [savingCaption,    setSavingCaption]    = useState(false)

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [{ data: userData }, { data: photoData }] = await Promise.all([
        supabase
          .from('users')
          .select('first_name, last_initial, profile_pic_url, is_verified, subscription_status')
          .eq('id', userId)
          .single(),
        supabase
          .from('model_photos')
          .select('id, photo_url, caption')
          .eq('user_id', userId)
          .order('created_at', { ascending: true })
          .limit(MAX_PHOTOS),
      ])

      if (userData) setProfile(userData as UserProfile)
      setPhotos(
        (photoData ?? []).map((p: any) => ({
          id: p.id,
          photoUrl: p.photo_url,
          caption: p.caption ?? null,
        }))
      )
    } catch {}
    setLoading(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  // ── Profile picture ────────────────────────────────────────────────────────

  const changeProfilePic = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need access to your photo library.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    })
    if (result.canceled || !result.assets[0]) return

    setUploading(true)
    const { uri } = result.assets[0]
    const fileName = `${userId}/profile.jpg`
    try {
      const manipulated = await ImageManipulator.manipulateAsync(uri, [], { base64: true })
      const { data: up, error } = await supabase.storage
        .from('profile-pics')
        .upload(fileName, decode(manipulated.base64!), { contentType: 'image/jpeg', upsert: true })
      if (!error && up) {
        const { data: urlData } = supabase.storage.from('profile-pics').getPublicUrl(up.path)
        await supabase.from('users').update({ profile_pic_url: urlData.publicUrl }).eq('id', userId)
        setProfile(p => p ? { ...p, profile_pic_url: urlData.publicUrl } : p)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      }
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
    setUploading(false)
  }

  // ── Gallery photos ─────────────────────────────────────────────────────────

  const addPhotos = async () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Gallery full', 'Remove a photo to make room for a new one.')
      return
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need access to your photo library.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      quality: 0.8,
    })
    if (result.canceled || result.assets.length === 0) return

    setAddingPhotos(true)
    const toAdd = result.assets.slice(0, MAX_PHOTOS - photos.length)
    let anyFailed = false
    for (const asset of toAdd) {
      try {
        const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
        const manipulated = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 1080 } }],
          { base64: true, compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
        )
        if (!manipulated.base64) {
          anyFailed = true
          Alert.alert('Upload failed', 'Could not process this image.')
          continue
        }
        const { data: up, error: uploadError } = await supabase.storage
          .from('model-photos')
          .upload(fileName, decode(manipulated.base64), { contentType: 'image/jpeg' })
        if (uploadError) {
          anyFailed = true
          Alert.alert('Upload failed', uploadError.message)
          continue
        }
        if (up) {
          const { data: urlData } = supabase.storage.from('model-photos').getPublicUrl(up.path)
          const { data: inserted, error: insertError } = await supabase
            .from('model_photos')
            .insert({ user_id: userId, photo_url: urlData.publicUrl, caption: null })
            .select('id')
            .single()
          if (insertError) {
            anyFailed = true
            Alert.alert('Save failed', insertError.message)
          } else if (inserted) {
            setPhotos(prev => [...prev, { id: (inserted as any).id, photoUrl: urlData.publicUrl, caption: null }])
          }
        }
      } catch (err: any) {
        anyFailed = true
        Alert.alert('Upload failed', err?.message ?? 'Could not upload photo.')
      }
    }
    if (!anyFailed) await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setAddingPhotos(false)
  }

  const openPhotoOptions = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setOptionsPhotoId(id)
  }

  const removePhoto = async () => {
    if (!optionsPhotoId) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setOptionsPhotoId(null)
    try {
      await supabase.from('model_photos').delete().eq('id', optionsPhotoId)
      setPhotos(prev => prev.filter(p => p.id !== optionsPhotoId))
    } catch {
      Alert.alert('Error', 'Could not remove photo.')
    }
  }

  const openCaptionEdit = () => {
    const photo = photos.find(p => p.id === optionsPhotoId)
    setCaptionText(photo?.caption ?? '')
    setCaptionPhotoId(optionsPhotoId)
    setOptionsPhotoId(null)
  }

  const saveCaption = async () => {
    if (!captionPhotoId) return
    setSavingCaption(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      await supabase
        .from('model_photos')
        .update({ caption: captionText.trim() || null })
        .eq('id', captionPhotoId)
      setPhotos(prev =>
        prev.map(p => p.id === captionPhotoId ? { ...p, caption: captionText.trim() || null } : p)
      )
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch {}
    setSavingCaption(false)
    setCaptionPhotoId(null)
  }

  // ── Verification ───────────────────────────────────────────────────────────

  const requestVerification = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    Alert.alert(
      'Get Verified',
      "Our team reviews each profile before awarding a verified badge. We check your portfolio quality and session history.\n\nWe'll notify you once reviewed — usually within 48 hours.",
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Request review',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            try {
              await supabase
                .from('verification_requests')
                .insert({ user_id: userId, type: 'model', status: 'pending' })
            } catch {}
            Alert.alert('Request sent', "We'll be in touch within 48 hours.")
          },
        },
      ]
    )
  }

  // ── Sign out ───────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => { signOut(); router.replace('/') },
      },
    ])
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const isVerified = !!profile?.is_verified
  const subInfo    = subscriptionLabel(profile?.subscription_status)
  const displayName = profile
    ? `${profile.first_name}${profile.last_initial ? ` ${profile.last_initial}.` : ''}`
    : ''
  const initials = profile
    ? `${profile.first_name[0] ?? ''}${profile.last_initial ?? ''}`.toUpperCase()
    : '?'

  const slots: (GalleryPhoto | null)[] = [
    ...photos,
    ...Array(Math.max(0, MAX_PHOTOS - photos.length)).fill(null),
  ]

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* ── Header bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>My Profile</Text>
        <TouchableOpacity
          style={styles.topBarRight}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(app)/settings' as any) }}
          activeOpacity={0.75}
        >
          <Ionicons name="settings-outline" size={20} color={Colors.warmDark} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* ── Profile card ── */}
        <View style={styles.profileCard}>
          <View style={styles.profileStrip} />
          {/* Avatar */}
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={changeProfilePic}
            activeOpacity={0.9}
            disabled={uploading}
          >
            {profile?.profile_pic_url ? (
              <Image source={{ uri: profile.profile_pic_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.cameraOverlay}>
              {uploading
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Ionicons name="camera" size={16} color={Colors.white} />
              }
            </View>
          </TouchableOpacity>

          {/* Name + badges */}
          <View style={styles.profileInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName}>{displayName}</Text>
              {isVerified && (
                <Ionicons name="checkmark-circle" size={20} color="#1D9E75" style={{ marginLeft: 6 }} />
              )}
            </View>
            <View style={styles.badgesRow}>
              <View style={[styles.subPill, { backgroundColor: subInfo.bg }]}>
                <Text style={[styles.subPillText, { color: subInfo.color }]}>{subInfo.text}</Text>
              </View>
              {isVerified && (
                <View style={styles.verifiedPill}>
                  <Ionicons name="shield-checkmark-outline" size={12} color="#1D9E75" />
                  <Text style={styles.verifiedPillText}>Verified</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Gallery section ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Photos</Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={addPhotos}
              disabled={addingPhotos || photos.length >= MAX_PHOTOS}
              activeOpacity={0.75}
            >
              {addingPhotos
                ? <ActivityIndicator size="small" color={Colors.roseDark} />
                : <Ionicons name="add-circle-outline" size={18} color={Colors.roseDark} />
              }
              <Text style={styles.addBtnText}>Add photo</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionSub}>
            Up to {MAX_PHOTOS} photos — stylists see these when you apply for a session.
          </Text>

          {/* Grid */}
          <View style={styles.photoGrid}>
            {slots.map((slot, i) =>
              slot ? (
                <TouchableOpacity
                  key={slot.id}
                  style={styles.photoCell}
                  onPress={() => openPhotoOptions(slot.id)}
                  activeOpacity={0.9}
                >
                  <Image source={{ uri: slot.photoUrl }} style={styles.photoImg} resizeMode="cover" />
                  <View style={styles.photoRemoveBtn}>
                    <Ionicons name="close-circle" size={22} color="rgba(255,255,255,0.95)" />
                  </View>
                  {slot.caption ? (
                    <View style={styles.captionBadge}>
                      <Text style={styles.captionBadgeText} numberOfLines={1}>{slot.caption}</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  key={`empty-${i}`}
                  style={styles.photoCellEmpty}
                  onPress={addPhotos}
                  disabled={addingPhotos}
                  activeOpacity={0.75}
                >
                  <Ionicons name="add" size={28} color={Colors.muted} />
                </TouchableOpacity>
              )
            )}
          </View>
        </View>

        {/* ── Get Verified card ── */}
        {!isVerified && (
          <View style={styles.verifyCard}>
            <View style={styles.verifyIconCircle}>
              <Ionicons name="shield-checkmark-outline" size={28} color={Colors.roseDark} />
            </View>
            <View style={styles.verifyText}>
              <Text style={styles.verifyTitle}>Get verified</Text>
              <Text style={styles.verifySub}>
                A verified badge builds trust with providers and helps you get more sessions.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.verifyBtn}
              onPress={requestVerification}
              activeOpacity={0.85}
            >
              <Text style={styles.verifyBtnText}>Request</Text>
              <Ionicons name="arrow-forward" size={14} color={Colors.roseDark} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Sign out ── */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color={Colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Photo options modal ── */}
      <Modal
        visible={!!optionsPhotoId}
        animationType="slide"
        transparent
        onRequestClose={() => setOptionsPhotoId(null)}
      >
        <View style={styles.sheetOuter}>
          <TouchableOpacity
            style={styles.sheetBackdrop}
            onPress={() => setOptionsPhotoId(null)}
            activeOpacity={1}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={openCaptionEdit}
              activeOpacity={0.8}
            >
              <View style={[styles.sheetItemIcon, { backgroundColor: Colors.inputBg }]}>
                <Ionicons name="pencil-outline" size={20} color={Colors.warmDark} />
              </View>
              <Text style={styles.sheetItemLabel}>Edit caption</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={removePhoto}
              activeOpacity={0.8}
            >
              <View style={[styles.sheetItemIcon, { backgroundColor: '#FEF2F2' }]}>
                <Ionicons name="trash-outline" size={20} color={Colors.error} />
              </View>
              <Text style={[styles.sheetItemLabel, { color: Colors.error }]}>Remove photo</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setOptionsPhotoId(null)
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Caption edit modal ── */}
      <Modal
        visible={!!captionPhotoId}
        animationType="slide"
        transparent
        onRequestClose={() => setCaptionPhotoId(null)}
      >
        <View style={styles.sheetOuter}>
          <TouchableOpacity
            style={styles.sheetBackdrop}
            onPress={() => setCaptionPhotoId(null)}
            activeOpacity={1}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.captionModalTitle}>Add a caption</Text>
            <TextInput
              style={styles.captionInput}
              value={captionText}
              onChangeText={t => setCaptionText(t.slice(0, 80))}
              placeholder="e.g. Natural nails, medium length"
              placeholderTextColor={Colors.muted}
              maxLength={80}
              autoFocus
            />
            <Text style={styles.captionCounter}>{captionText.length}/80</Text>
            <View style={styles.captionActions}>
              <TouchableOpacity
                style={styles.captionCancelBtn}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setCaptionPhotoId(null)
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.captionCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.captionSaveBtn, savingCaption && { opacity: 0.5 }]}
                onPress={saveCaption}
                disabled={savingCaption}
                activeOpacity={0.9}
              >
                {savingCaption
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.captionSaveText}>Save</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  centred:   { alignItems: 'center', justifyContent: 'center' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },
  topBarRight: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  scroll: { paddingHorizontal: 20, paddingTop: 20 },

  // Profile card
  profileCard: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    marginBottom: 20,
    overflow: 'hidden',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    paddingBottom: 24,
  },
  profileStrip: {
    width: '100%',
    height: 80,
    backgroundColor: Colors.roseDark,
  },
  avatarWrap: {
    marginTop: -48,
    marginBottom: 14,
    position: 'relative',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: Colors.white,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.white,
  },
  avatarInitials: {
    fontSize: 34,
    fontWeight: '800',
    color: Colors.roseDark,
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.roseDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  profileInfo: { alignItems: 'center', gap: 10 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  displayName: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.4,
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  subPill: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  subPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  verifiedPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D9E75',
  },

  // Section
  section: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },
  sectionSub: {
    fontSize: 12,
    color: Colors.muted,
    lineHeight: 17,
    marginBottom: 14,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.roseDark,
  },

  // Photo grid
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CELL_GAP,
  },
  photoCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  photoImg: {
    width: CELL_SIZE,
    height: CELL_SIZE,
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  captionBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(61,46,46,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  captionBadgeText: {
    fontSize: 10,
    color: Colors.white,
    fontWeight: '500',
  },
  photoCellEmpty: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.inputBg,
  },

  // Get verified card
  verifyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: Colors.softPink,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  verifyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.softPink + '40',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  verifyText: { flex: 1 },
  verifyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.warmDark,
    marginBottom: 3,
  },
  verifySub: {
    fontSize: 12,
    color: Colors.muted,
    lineHeight: 17,
  },
  verifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.softPink + '50',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexShrink: 0,
  },
  verifyBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.roseDark,
  },

  // Sign out
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 4,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.error,
  },

  // Bottom sheets (shared)
  sheetOuter: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 16,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sheetItemIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sheetItemLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  sheetCancel: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sheetCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.warmDark,
  },

  // Caption modal
  captionModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.warmDark,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  captionInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.warmDark,
  },
  captionCounter: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 16,
  },
  captionActions: {
    flexDirection: 'row',
    gap: 10,
  },
  captionCancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  captionCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  captionSaveBtn: {
    flex: 2,
    height: 50,
    borderRadius: 14,
    backgroundColor: Colors.roseDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  captionSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.white,
  },
})
