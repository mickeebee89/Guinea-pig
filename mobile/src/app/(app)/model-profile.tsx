import { useState, useCallback, useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
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
import { isIdentityVerified } from '@/lib/verification'
import ScreenDecor from '@/components/ScreenDecor'
import LoadErrorState from '@/components/LoadErrorState'

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
  instagram_handle: string | null
}

type ModelAttrs = {
  hair_colour:     string | null
  hair_type:       string | null
  hair_length:     string | null
  hair_condition:  string | null
  skin_tone:       string | null
  skin_type:       string | null
  eye_colour:      string | null
  eye_shape:       string | null
  nail_condition:  string | null
  bio:             string | null
}

const ATTR_DEFS: { key: keyof ModelAttrs; label: string; options: string[] }[] = [
  { key: 'hair_colour',    label: 'Hair colour',    options: ['Black','Dark Brown','Medium Brown','Light Brown','Blonde','Platinum Blonde','Red','Auburn','Grey','White','Dyed'] },
  { key: 'hair_type',     label: 'Hair type',      options: ['Straight','Wavy','Curly','Coily'] },
  { key: 'hair_length',   label: 'Hair length',    options: ['Short','Medium','Long','Very Long'] },
  { key: 'hair_condition',label: 'Hair condition', options: ['Healthy','Dry','Oily','Colour-treated','Damaged'] },
  { key: 'skin_tone',     label: 'Skin tone',      options: ['Fair','Light','Medium','Olive','Brown','Dark Brown','Deep'] },
  { key: 'skin_type',     label: 'Skin type',      options: ['Normal','Dry','Oily','Combination','Sensitive','Acne-prone'] },
  { key: 'eye_colour',    label: 'Eye colour',     options: ['Brown','Dark Brown','Hazel','Green','Blue','Grey','Amber'] },
  { key: 'eye_shape',     label: 'Eye shape',      options: ['Round','Almond','Hooded','Monolid','Upturned','Downturned'] },
  { key: 'nail_condition',label: 'Nails',          options: ['Healthy','Brittle','Bitten','Long natural','Short','Acrylic','Gel'] },
]

const EMPTY_ATTRS: ModelAttrs = {
  hair_colour:    null, hair_type:      null,
  hair_length:    null, hair_condition: null,
  skin_tone:      null, skin_type:      null,
  eye_colour:     null, eye_shape:      null,
  nail_condition: null, bio:            null,
}

type Category = {
  id: string
  name: string
  sort_order: number
}

type GalleryPhoto = {
  id: string
  photoUrl: string
  caption: string | null
  category_id: string | null
}

type ModelReview = {
  id: string
  rating: number
  comment: string | null
  tags: string[]
  created_at: string
  reviewer_id: string
  reviewer_name: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByCategory(
  photos: GalleryPhoto[],
  cats: Category[],
): { label: string; catId: string | null; items: GalleryPhoto[] }[] {
  const groups: { label: string; catId: string | null; items: GalleryPhoto[] }[] = []
  for (const cat of cats) {
    const items = photos.filter(p => p.category_id === cat.id)
    if (items.length > 0) groups.push({ label: cat.name, catId: cat.id, items })
  }
  const uncat = photos.filter(p => !p.category_id)
  if (uncat.length > 0) groups.push({ label: 'Uncategorised', catId: null, items: uncat })
  return groups
}

// ── Inline save status ──────────────────────────────────────────────────────────

const SAVED_GREEN = '#1D9E75'  // matches the verified-check green used in this screen

type FieldStatus = 'saved' | 'error'

// One shared indicator for every per-field save: transient "Saved ✓" or an
// inline error. Pass the per-field status from the `saveStatus` map below.
function SaveStatus({ status, style }: { status?: FieldStatus; style?: any }) {
  if (!status) return null
  const ok = status === 'saved'
  return (
    <View style={[styles.saveStatusRow, style]}>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'alert-circle'}
        size={14}
        color={ok ? SAVED_GREEN : Colors.error}
      />
      <Text style={[styles.saveStatusText, { color: ok ? SAVED_GREEN : Colors.error }]}>
        {ok ? 'Saved' : "Couldn't save — try again"}
      </Text>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ModelProfileScreen() {
  const router   = useRouter()
  const { session, signOut } = useAuth()
  const insets   = useSafeAreaInsets()
  const userId   = session?.user?.id

  const [profile,          setProfile]          = useState<UserProfile | null>(null)
  const [photos,           setPhotos]           = useState<GalleryPhoto[]>([])
  const [attrs,            setAttrs]            = useState<ModelAttrs>(EMPTY_ATTRS)
  const [attrsPicker,      setAttrsPicker]      = useState<keyof ModelAttrs | null>(null)
  const [attrsCustomText,  setAttrsCustomText]  = useState('')
  const [savingAttrs,      setSavingAttrs]      = useState(false)
  const [bioText,          setBioText]          = useState('')
  const [savingBio,        setSavingBio]        = useState(false)
  const [instagramHandle,  setInstagramHandle]  = useState('')
  const [savingInstagram,  setSavingInstagram]  = useState(false)
  const [loading,          setLoading]          = useState(true)
  const [loadError,        setLoadError]        = useState(false)
  const [uploading,        setUploading]        = useState(false)
  const [addingPhotos,     setAddingPhotos]     = useState(false)
  const [categories,       setCategories]       = useState<Category[]>([])
  const [showNewCatModal,  setShowNewCatModal]  = useState(false)
  const [newCatName,       setNewCatName]       = useState('')
  const [savingCat,        setSavingCat]        = useState(false)
  const [showCatPicker,    setShowCatPicker]    = useState(false)
  const [pendingAssets,    setPendingAssets]    = useState<ImagePicker.ImagePickerAsset[]>([])
  const [pickedCatId,      setPickedCatId]      = useState<string | null>(null)
  const [pickedCatName,    setPickedCatName]    = useState<string | null>(null)
  const [optionsPhotoId,   setOptionsPhotoId]   = useState<string | null>(null)
  const [captionPhotoId,   setCaptionPhotoId]   = useState<string | null>(null)
  const [captionText,      setCaptionText]      = useState('')
  const [savingCaption,    setSavingCaption]    = useState(false)
  const [isVerified,       setIsVerified]       = useState(false)
  const [reviews,          setReviews]          = useState<ModelReview[]>([])

  // ── Shared per-field save feedback ──────────────────────────────────────────
  // One mechanism used by every per-field save below, so success/error feedback
  // is consistent (transient "Saved ✓" / inline error) rather than a one-off.
  const [saveStatus, setSaveStatus] = useState<Record<string, FieldStatus>>({})
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const clearStatus = useCallback((key: string) => {
    if (savedTimers.current[key]) { clearTimeout(savedTimers.current[key]); delete savedTimers.current[key] }
    setSaveStatus(prev => {
      if (!(key in prev)) return prev
      const next = { ...prev }; delete next[key]; return next
    })
  }, [])

  const flashSaved = useCallback((key: string) => {
    if (savedTimers.current[key]) clearTimeout(savedTimers.current[key])
    setSaveStatus(prev => ({ ...prev, [key]: 'saved' }))
    savedTimers.current[key] = setTimeout(() => {
      setSaveStatus(prev => { const next = { ...prev }; delete next[key]; return next })
      delete savedTimers.current[key]
    }, 2000)
  }, [])

  const flashError = useCallback((key: string) => {
    if (savedTimers.current[key]) { clearTimeout(savedTimers.current[key]); delete savedTimers.current[key] }
    setSaveStatus(prev => ({ ...prev, [key]: 'error' }))
  }, [])

  // Clear any pending fade timers on unmount.
  useEffect(() => () => { Object.values(savedTimers.current).forEach(clearTimeout) }, [])

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!userId) return
    setLoadError(false)
    try {
      const [{ data: userData }, { data: photoData }, { data: attrData }, { data: catData }, verified] = await Promise.all([
        supabase
          .from('users')
          .select('first_name, last_initial, profile_pic_url, instagram_handle')
          .eq('id', userId)
          .single(),
        supabase
          .from('model_photos')
          .select('id, photo_url, caption, category_id')
          .eq('user_id', userId)
          .order('created_at', { ascending: true }),
        supabase
          .from('model_attributes')
          .select('hair_colour, hair_type, hair_length, hair_condition, skin_tone, skin_type, eye_colour, eye_shape, nail_condition, bio')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('model_photo_categories')
          .select('id, name, sort_order')
          .eq('user_id', userId)
          .order('sort_order'),
        isIdentityVerified(userId),
      ])

      if (userData) {
        setProfile(userData as UserProfile)
        setInstagramHandle((userData as any).instagram_handle ?? '')
      }
      setIsVerified(verified)
      setCategories((catData ?? []) as Category[])
      setPhotos(
        (photoData ?? []).map((p: any) => ({
          id: p.id,
          photoUrl: p.photo_url,
          caption: p.caption ?? null,
          category_id: p.category_id ?? null,
        }))
      )
      if (attrData) {
        setAttrs(attrData as ModelAttrs)
        setBioText((attrData as any).bio ?? '')
      }
    } catch (e) {
      console.error('model-profile load failed:', e)
      setLoadError(true)
    }

    // Fetch reviews where this model is the reviewee
    try {
      const { data: revData, error: revErr } = await supabase
        .from('reviews')
        .select('id, rating:overall_rating, comment, tags, created_at, reviewer_id')
        .eq('reviewee_id', userId)
        .order('created_at', { ascending: false })

      if (revData && (revData as any[]).length > 0) {
        const reviewerIds = [...new Set((revData as any[]).map((r: any) => r.reviewer_id))]
        const { data: reviewerUsers, error: reviewerErr } = await supabase
          .from('public_profiles')
          .select('id, first_name, last_initial')
          .in('id', reviewerIds)
        if (reviewerErr) console.warn('SELF REVIEWS users lookup', reviewerErr)
        const userMap: Record<string, string> = {}
        ;(reviewerUsers as any[] ?? []).forEach((u: any) => {
          const name = `${u.first_name ?? ''}${u.last_initial ? ' ' + u.last_initial + '.' : ''}`.trim()
          userMap[u.id] = name || 'Anonymous'
        })
        setReviews((revData as any[]).map((r: any) => ({
          id:            r.id,
          rating:        r.rating,
          comment:       r.comment ?? null,
          tags:          Array.isArray(r.tags) ? r.tags : [],
          created_at:    r.created_at,
          reviewer_id:   r.reviewer_id,
          reviewer_name: userMap[r.reviewer_id] ?? 'Anonymous',
        })))
      }
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
        // Fixed-filename upload → identical URL → stale image cache. Stamp a
        // per-save cache-buster into the stored URL once; read sites render as-is.
        const { data: urlData } = supabase.storage.from('profile-pics').getPublicUrl(up.path)
        const newUrl = `${urlData.publicUrl}?t=${Date.now()}`
        await supabase.from('users').update({ profile_pic_url: newUrl }).eq('id', userId)
        setProfile(p => p ? { ...p, profile_pic_url: newUrl } : p)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      }
    } catch (e) {
      console.error('model changeProfilePic failed:', e)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Couldn’t update photo', 'Please try again.')
    }
    setUploading(false)
  }

  // ── Gallery photos ─────────────────────────────────────────────────────────

  const addPhotos = async () => {
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

    if (categories.length > 0) {
      setPendingAssets(result.assets)
      setPickedCatId(null)
      setPickedCatName(null)
      setShowCatPicker(true)
    } else {
      if (photos.filter(p => !p.category_id).length >= MAX_PHOTOS) {
        Alert.alert('Gallery full', 'Remove a photo to make room for a new one.')
        return
      }
      await uploadPhotos(result.assets, null, null)
    }
  }

  const confirmUpload = async () => {
    if (!pendingAssets.length) return
    const bucketCount = pickedCatId
      ? photos.filter(p => p.category_id === pickedCatId).length
      : photos.filter(p => !p.category_id).length
    if (bucketCount >= MAX_PHOTOS) {
      Alert.alert(
        'Category full',
        `"${pickedCatName ?? 'Uncategorised'}" already has ${MAX_PHOTOS} photos. Remove one to add more.`,
      )
      setShowCatPicker(false)
      setPendingAssets([])
      return
    }
    setShowCatPicker(false)
    await uploadPhotos(pendingAssets, pickedCatId, pickedCatName)
    setPendingAssets([])
  }

  const uploadPhotos = async (
    assets: ImagePicker.ImagePickerAsset[],
    catId: string | null,
    _catName: string | null,
  ) => {
    if (!userId) return
    const bucketCount = catId
      ? photos.filter(p => p.category_id === catId).length
      : photos.filter(p => !p.category_id).length
    const toAdd = assets.slice(0, MAX_PHOTOS - bucketCount)
    setAddingPhotos(true)
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
            .insert({ user_id: userId, photo_url: urlData.publicUrl, caption: null, category_id: catId })
            .select('id')
            .single()
          if (insertError) {
            anyFailed = true
            Alert.alert('Save failed', insertError.message)
          } else if (inserted) {
            setPhotos(prev => [...prev, {
              id: (inserted as any).id,
              photoUrl: urlData.publicUrl,
              caption: null,
              category_id: catId,
            }])
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
    clearStatus('caption')
    setCaptionPhotoId(optionsPhotoId)
    setOptionsPhotoId(null)
  }

  const saveCaption = async () => {
    if (!captionPhotoId) return
    setSavingCaption(true)
    clearStatus('caption')
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
      flashSaved('caption')
      setSavingCaption(false)
      // Briefly show "Saved ✓" in the sheet, then close it.
      setTimeout(() => setCaptionPhotoId(null), 900)
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      flashError('caption')
      setSavingCaption(false)
      // Keep the sheet open so the inline error stays visible.
    }
  }

  const handleCreateCategory = async () => {
    const name = newCatName.trim()
    if (!name || !userId) return
    setSavingCat(true)
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      const { data: inserted, error } = await supabase
        .from('model_photo_categories')
        .insert({ user_id: userId, name, sort_order: categories.length })
        .select('id, name, sort_order')
        .single()
      if (error) throw error
      setCategories(prev => [...prev, inserted as Category])
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setNewCatName('')
      setShowNewCatModal(false)
      Alert.alert('Category created', `"${name}" has been added.`)
    } catch {
      Alert.alert('Error', 'Could not create category. Please try again.')
    }
    setSavingCat(false)
  }

  const handleDeleteCategory = (cat: Category) => {
    const count = photos.filter(p => p.category_id === cat.id).length
    Alert.alert(
      `Delete "${cat.name}"?`,
      count > 0
        ? `This will remove the category. ${count === 1 ? '1 photo' : `${count} photos`} will move to Uncategorised.`
        : 'This category has no photos.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            try {
              await supabase.from('model_photo_categories').delete().eq('id', cat.id)
              setCategories(prev => prev.filter(c => c.id !== cat.id))
              setPhotos(prev => prev.map(p =>
                p.category_id === cat.id ? { ...p, category_id: null } : p
              ))
            } catch {
              Alert.alert('Error', 'Could not delete category.')
            }
          },
        },
      ]
    )
  }

  // ── Model attributes ────────────────────────────────────────────────────────

  const openAttrPicker = async (key: keyof ModelAttrs) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setAttrsCustomText('')
    setAttrsPicker(key)
  }

  const selectAttr = async (key: keyof ModelAttrs, value: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const updated = { ...attrs, [key]: value }
    setAttrs(updated)
    setAttrsPicker(null)
    setSavingAttrs(true)
    clearStatus('attrs')
    try {
      const { data: existing } = await supabase
        .from('model_attributes').select('user_id').eq('user_id', userId!).maybeSingle()
      if (existing) {
        await supabase.from('model_attributes').update({ [key]: value, updated_at: new Date().toISOString() }).eq('user_id', userId!)
      } else {
        await supabase.from('model_attributes').insert({ user_id: userId!, [key]: value })
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      flashSaved('attrs')
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      flashError('attrs')
    }
    setSavingAttrs(false)
  }

  const clearAttr = async (key: keyof ModelAttrs) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setAttrs(prev => ({ ...prev, [key]: null }))
    clearStatus('attrs')
    try {
      await supabase.from('model_attributes').update({ [key]: null }).eq('user_id', userId!)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      flashSaved('attrs')
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      flashError('attrs')
    }
  }

  // ── Bio ────────────────────────────────────────────────────────────────────

  const saveBio = async () => {
    if (!userId) return
    setSavingBio(true)
    clearStatus('bio')
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      const { data: existing } = await supabase
        .from('model_attributes').select('user_id').eq('user_id', userId).maybeSingle()
      if (existing) {
        await supabase.from('model_attributes').update({ bio: bioText.trim() || null }).eq('user_id', userId)
      } else {
        await supabase.from('model_attributes').insert({ user_id: userId, bio: bioText.trim() || null })
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      flashSaved('bio')
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      flashError('bio')
    }
    setSavingBio(false)
  }

  // ── Instagram ─────────────────────────────────────────────────────────────

  const saveInstagram = async () => {
    if (!userId) return
    setSavingInstagram(true)
    clearStatus('instagram')
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const raw = instagramHandle.trim()
    const urlMatch = raw.match(/instagram\.com\/([^/?#]+)/)
    const handle = urlMatch ? urlMatch[1] : raw.replace(/^@/, '')
    setInstagramHandle(handle)
    const { data, error } = await supabase
      .from('users')
      .update({ instagram_handle: handle || null })
      .eq('id', userId)
    if (error) {
      console.warn('saveInstagram', error.message)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      flashError('instagram')
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      flashSaved('instagram')
    }
    setSavingInstagram(false)
  }

  // ── Sign out ───────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => signOut(),
      },
    ])
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const displayName = profile
    ? `${profile.first_name}${profile.last_initial ? ` ${profile.last_initial}.` : ''}`
    : ''
  const initials = profile
    ? `${profile.first_name[0] ?? ''}${profile.last_initial ?? ''}`.toUpperCase()
    : '?'

  const photoGroups = groupByCategory(photos, categories)

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={[styles.container, styles.centred]}>
        <LoadErrorState onRetry={() => load()} />
      </View>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScreenDecor />
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

          <Text style={styles.avatarCaption}>Use a clear photo of your face.</Text>

          {/* Name + badges */}
          <View style={styles.profileInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName}>{displayName}</Text>
              {isVerified && (
                <Ionicons name="checkmark-circle" size={20} color="#1D9E75" style={{ marginLeft: 6 }} />
              )}
            </View>
          </View>
        </View>

        {/* ── About me (bio) ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>About me</Text>
            {savingBio && <ActivityIndicator size="small" color={Colors.roseDark} />}
          </View>
          <Text style={styles.sectionSub}>
            A short intro visible to stylists on your public profile.
          </Text>
          <TextInput
            style={styles.bioInput}
            value={bioText}
            onChangeText={t => setBioText(t.slice(0, 200))}
            placeholder="Tell stylists a bit about yourself…"
            placeholderTextColor={Colors.muted}
            multiline
            textAlignVertical="top"
            maxLength={200}
          />
          <Text style={styles.bioCounter}>{bioText.length}/200</Text>
          <TouchableOpacity
            style={[styles.bioSaveBtn, savingBio && { opacity: 0.6 }]}
            onPress={saveBio}
            disabled={savingBio}
            activeOpacity={0.9}
          >
            <Text style={styles.bioSaveBtnText}>Save bio</Text>
          </TouchableOpacity>
          <SaveStatus status={saveStatus.bio} style={{ marginTop: 8 }} />

          <View style={styles.igRow}>
            <Ionicons name="logo-instagram" size={20} color="#C13584" style={{ flexShrink: 0 }} />
            <TextInput
              style={styles.igInput}
              value={instagramHandle}
              onChangeText={setInstagramHandle}
              placeholder="your_handle or paste a link"
              placeholderTextColor={Colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={saveInstagram}
            />
            <TouchableOpacity
              style={[styles.igSaveBtn, savingInstagram && { opacity: 0.6 }]}
              onPress={saveInstagram}
              disabled={savingInstagram}
              activeOpacity={0.9}
            >
              {savingInstagram
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Text style={styles.igSaveBtnText}>Save</Text>
              }
            </TouchableOpacity>
          </View>
          <SaveStatus status={saveStatus.instagram} style={{ marginTop: 8 }} />
        </View>

        {/* ── Gallery section ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Photos</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setNewCatName('')
                  setShowNewCatModal(true)
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="add-circle-outline" size={18} color={Colors.roseDark} />
                <Text style={styles.addBtnText}>Add category</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={addPhotos}
                disabled={addingPhotos}
                activeOpacity={0.75}
              >
                {addingPhotos
                  ? <ActivityIndicator size="small" color={Colors.roseDark} />
                  : <Ionicons name="add-circle-outline" size={18} color={Colors.roseDark} />
                }
                <Text style={styles.addBtnText}>Add photo</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.sectionSub}>
            Up to {MAX_PHOTOS} photos per category — stylists see these when you apply for a treatment.
          </Text>

          {photoGroups.length === 0 ? (
            <Text style={{ fontSize: 13, color: Colors.muted, textAlign: 'center', paddingVertical: 8 }}>
              No photos yet — tap Add photo to get started.
            </Text>
          ) : (
            photoGroups.map(group => (
              <View key={group.catId ?? '__uncat__'} style={styles.catSection}>
                <View style={styles.catSectionHeader}>
                  <Text style={styles.catLabel}>{group.label}</Text>
                  {group.catId && (
                    <TouchableOpacity
                      onPress={() => {
                        const cat = categories.find(c => c.id === group.catId)
                        if (cat) handleDeleteCategory(cat)
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={14} color={Colors.muted} />
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: CELL_GAP }}
                >
                  {group.items.map(photo => (
                    <TouchableOpacity
                      key={photo.id}
                      style={styles.photoCell}
                      onPress={() => openPhotoOptions(photo.id)}
                      activeOpacity={0.9}
                    >
                      <Image source={{ uri: photo.photoUrl }} style={styles.photoImg} resizeMode="cover" />
                      <View style={styles.photoRemoveBtn}>
                        <Ionicons name="close-circle" size={22} color="rgba(255,255,255,0.95)" />
                      </View>
                      {photo.caption ? (
                        <View style={styles.captionBadge}>
                          <Text style={styles.captionBadgeText} numberOfLines={1}>{photo.caption}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ))
          )}
        </View>

        {/* ── My Details ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Details</Text>
            <View style={styles.sectionHeaderRight}>
              {savingAttrs && <ActivityIndicator size="small" color={Colors.roseDark} />}
              <SaveStatus status={saveStatus.attrs} />
            </View>
          </View>
          <Text style={styles.sectionSub}>
            Help stylists understand your features so they can prepare the right look.
          </Text>
          {ATTR_DEFS.map((def, i) => (
            <TouchableOpacity
              key={def.key}
              style={[styles.attrRow, i < ATTR_DEFS.length - 1 && styles.attrRowBorder]}
              onPress={() => openAttrPicker(def.key)}
              activeOpacity={0.75}
            >
              <Text style={styles.attrLabel}>{def.label}</Text>
              <View style={styles.attrRight}>
                {attrs[def.key] ? (
                  <>
                    <View style={styles.attrValuePill}>
                      <Text style={styles.attrValue}>{attrs[def.key]}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => clearAttr(def.key)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={16} color={Colors.muted} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={styles.attrEmpty}>Tap to set</Text>
                )}
                <Ionicons name="chevron-forward" size={15} color={Colors.muted} />
              </View>
            </TouchableOpacity>
          ))}
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
                A verified badge builds trust with providers and helps you get more treatments.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.verifyBtn}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                router.push('/(app)/verify-payment' as any)
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.verifyBtnText}>Start</Text>
              <Ionicons name="arrow-forward" size={14} color={Colors.roseDark} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── My Reviews ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              My Reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}
            </Text>
            {reviews.length > 0 && (() => {
              const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
              return (
                <View style={styles.reviewsAvgWrap}>
                  <Ionicons name="star" size={14} color="#F59E0B" />
                  <Text style={styles.reviewsAvgText}>{avg.toFixed(1)}</Text>
                </View>
              )
            })()}
          </View>
          {reviews.length === 0 ? (
            <Text style={styles.reviewsEmpty}>No reviews yet.</Text>
          ) : (
            reviews.map(r => (
              <View key={r.id} style={styles.reviewItem}>
                <View style={styles.reviewItemHeader}>
                  <View style={styles.reviewInitialsBox}>
                    <Text style={styles.reviewInitialsText}>
                      {r.reviewer_name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.reviewerName}>{r.reviewer_name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      {[1,2,3,4,5].map(s => (
                        <Ionicons key={s} name={s <= r.rating ? 'star' : 'star-outline'} size={12} color={s <= r.rating ? '#F59E0B' : Colors.border} />
                      ))}
                      <Text style={styles.reviewDate}>
                        {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                </View>
                {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
                {r.tags.length > 0 && (
                  <View style={styles.reviewTagsRow}>
                    {r.tags.map(tag => (
                      <View key={tag} style={styles.reviewTagChip}>
                        <Text style={styles.reviewTagChipText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))
          )}
        </View>

        {/* ── Verification status ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Verification</Text>
            <View style={[styles.subPill, { backgroundColor: isVerified ? '#D1FAE5' : Colors.inputBg }]}>
              <Text style={[styles.subPillText, { color: isVerified ? '#1D9E75' : Colors.muted }]}>{isVerified ? 'Verified' : 'Not verified'}</Text>
            </View>
          </View>
          {!isVerified && (
            <Text style={styles.sectionSub}>
              Get verified to apply for treatments and build trust with providers.
            </Text>
          )}
        </View>

        {/* ── Sign out ── */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color={Colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Create category modal ── */}
      <Modal
        visible={showNewCatModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowNewCatModal(false)}
      >
        <View style={styles.sheetOuter}>
          <TouchableOpacity style={styles.sheetBackdrop} onPress={() => setShowNewCatModal(false)} activeOpacity={1} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.catModalTitle}>Create category</Text>
            <Text style={styles.catModalSub}>Group your photos under a heading, e.g. "Nails" or "Hair"</Text>
            <TextInput
              style={styles.catModalInput}
              value={newCatName}
              onChangeText={setNewCatName}
              placeholder="Category name"
              placeholderTextColor={Colors.muted}
              autoFocus
              maxLength={40}
              returnKeyType="done"
              onSubmitEditing={handleCreateCategory}
            />
            <TouchableOpacity
              style={[styles.catModalBtn, (!newCatName.trim() || savingCat) && { opacity: 0.4 }]}
              onPress={handleCreateCategory}
              disabled={!newCatName.trim() || savingCat}
              activeOpacity={0.9}
            >
              {savingCat
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.catModalBtnText}>Create</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => setShowNewCatModal(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Category picker modal ── */}
      <Modal
        visible={showCatPicker}
        animationType="slide"
        transparent
        onRequestClose={() => { setShowCatPicker(false); setPendingAssets([]) }}
      >
        <View style={styles.sheetOuter}>
          <TouchableOpacity
            style={styles.sheetBackdrop}
            onPress={() => { setShowCatPicker(false); setPendingAssets([]) }}
            activeOpacity={1}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.catModalTitle}>Add to category</Text>
            <Text style={styles.catModalSub}>Optional — choose where this photo belongs</Text>
            <ScrollView style={styles.catPickerList} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={[styles.catPickerItem, pickedCatId === null && styles.catPickerItemSelected]}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setPickedCatId(null)
                  setPickedCatName(null)
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.catPickerItemText, pickedCatId === null && styles.catPickerItemTextSelected]}>
                  No category
                </Text>
                {pickedCatId === null && <Ionicons name="checkmark-circle" size={18} color={Colors.roseDark} />}
              </TouchableOpacity>
              {categories.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.catPickerItem, pickedCatId === cat.id && styles.catPickerItemSelected]}
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setPickedCatId(cat.id)
                    setPickedCatName(cat.name)
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.catPickerItemText, pickedCatId === cat.id && styles.catPickerItemTextSelected]}>
                    {cat.name}
                  </Text>
                  {pickedCatId === cat.id && <Ionicons name="checkmark-circle" size={18} color={Colors.roseDark} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.catModalBtn} onPress={confirmUpload} activeOpacity={0.9}>
              <Text style={styles.catModalBtnText}>Upload photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => { setShowCatPicker(false); setPendingAssets([]) }}
              activeOpacity={0.8}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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

      {/* ── Attribute picker modal ── */}
      <Modal
        visible={!!attrsPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setAttrsPicker(null)}
      >
        <View style={styles.sheetOuter}>
          <TouchableOpacity style={styles.sheetBackdrop} onPress={() => setAttrsPicker(null)} activeOpacity={1} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20), maxHeight: '70%' }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.captionModalTitle}>
              {attrsPicker ? ATTR_DEFS.find(d => d.key === attrsPicker)?.label ?? '' : ''}
            </Text>
            <FlatList
              data={attrsPicker ? [...(ATTR_DEFS.find(d => d.key === attrsPicker)?.options ?? []), 'Other…'] : []}
              keyExtractor={item => item}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isOther = item === 'Other…'
                const isSelected = attrsPicker ? attrs[attrsPicker] === item : false
                return (
                  <TouchableOpacity
                    style={[styles.attrOptionRow, isSelected && styles.attrOptionSelected]}
                    onPress={() => {
                      if (isOther) {
                        setAttrsCustomText(attrsPicker && attrs[attrsPicker] ? attrs[attrsPicker]! : '')
                      } else if (attrsPicker) {
                        selectAttr(attrsPicker, item)
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.attrOptionText, isSelected && { color: Colors.roseDark, fontWeight: '700' }]}>
                      {item}
                    </Text>
                    {isSelected && <Ionicons name="checkmark" size={16} color={Colors.roseDark} />}
                  </TouchableOpacity>
                )
              }}
              ListFooterComponent={
                attrsCustomText !== '' || (attrsPicker && attrs[attrsPicker] && !ATTR_DEFS.find(d => d.key === attrsPicker)?.options.includes(attrs[attrsPicker]!)) ? (
                  <View style={{ paddingTop: 8, gap: 8 }}>
                    <TextInput
                      style={styles.captionInput}
                      value={attrsCustomText}
                      onChangeText={setAttrsCustomText}
                      placeholder="Type your own…"
                      placeholderTextColor={Colors.muted}
                      maxLength={60}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={[styles.captionSaveBtn, !attrsCustomText.trim() && { opacity: 0.4 }]}
                      onPress={() => { if (attrsPicker && attrsCustomText.trim()) selectAttr(attrsPicker, attrsCustomText.trim()) }}
                      disabled={!attrsCustomText.trim()}
                      activeOpacity={0.9}
                    >
                      <Text style={styles.captionSaveText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                ) : null
              }
            />
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
            <SaveStatus status={saveStatus.caption} style={{ marginTop: 4, marginBottom: 4 }} />
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
  container: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },
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
    fontFamily: 'DancingScript_700Bold',
    flex: 1,
    textAlign: 'center',
    fontSize: 25,
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
    height: 60,
    backgroundColor: Colors.roseDark,
  },
  avatarWrap: {
    marginTop: -48,
    marginBottom: 8,
    position: 'relative',
  },
  avatarCaption: {
    fontSize: 12, color: Colors.muted, textAlign: 'center',
    marginBottom: 10,
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
    fontFamily: 'DancingScript_700Bold',
    fontSize: 33,
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
    fontFamily: 'DancingScript_700Bold',
    fontSize: 24,
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

  // Shared inline save status ("Saved ✓" / error)
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  saveStatusText: {
    fontSize: 12,
    fontWeight: '600',
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

  // Category folder button
  catFolderBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.softPink + '40',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.softPink,
  },

  // Category sections
  catSection: { marginBottom: 16 },
  catSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  catLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Category modal shared
  catModalTitle: {
    fontFamily: 'DancingScript_700Bold',
    fontSize: 25,
    color: Colors.warmDark,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  catModalSub: {
    fontSize: 12,
    color: Colors.muted,
    lineHeight: 17,
    marginBottom: 16,
  },
  catModalInput: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.warmDark,
    marginBottom: 14,
  },
  catModalBtn: {
    backgroundColor: Colors.roseDark,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  catModalBtnText: { fontSize: 15, fontWeight: '700', color: Colors.white },

  // Category picker list
  catPickerList: { maxHeight: 220, marginBottom: 14 },
  catPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catPickerItemSelected: { borderColor: Colors.roseDark, backgroundColor: Colors.softPink + '20' },
  catPickerItemText: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },
  catPickerItemTextSelected: { color: Colors.roseDark },

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

  // Reviews
  reviewsAvgWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF9C3', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  reviewsAvgText: { fontSize: 13, fontWeight: '700', color: '#B45309' },
  reviewsEmpty: { fontSize: 14, color: Colors.muted, textAlign: 'center', paddingVertical: 12 },
  reviewItem: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 12, marginTop: 12 },
  reviewItemHeader: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'center' },
  reviewInitialsBox: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.softPink, alignItems: 'center', justifyContent: 'center' },
  reviewInitialsText: { fontSize: 13, fontWeight: '700', color: Colors.roseDark },
  reviewerName: { fontSize: 14, fontWeight: '600', color: Colors.warmDark },
  reviewDate: { fontSize: 11, color: Colors.muted },
  reviewComment: { fontSize: 14, color: Colors.warmDark, lineHeight: 20, opacity: 0.85, marginBottom: 6 },
  reviewTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  reviewTagChip: { backgroundColor: Colors.inputBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  reviewTagChipText: { fontSize: 11, fontWeight: '600', color: Colors.roseDark },

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

  // Bio
  bioInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.warmDark,
    minHeight: 90,
    lineHeight: 20,
  },
  bioCounter: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 10,
  },
  bioSaveBtn: {
    height: 44,
    backgroundColor: Colors.roseDark,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bioSaveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
  },

  // Instagram field
  igRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  igInput: {
    flex: 1,
    height: 44,
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.warmDark,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  igSaveBtn: {
    height: 44,
    paddingHorizontal: 16,
    backgroundColor: Colors.roseDark,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  igSaveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
  },

  // Attribute rows
  attrRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
  },
  attrRowBorder: {
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  attrLabel: { fontSize: 14, color: Colors.warmDark, fontWeight: '600', flex: 1 },
  attrRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  attrValuePill: {
    backgroundColor: Colors.softPink + '40', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4,
  },
  attrValue: { fontSize: 13, fontWeight: '600', color: Colors.roseDark },
  attrEmpty: { fontSize: 13, color: Colors.muted },
  attrOptionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  attrOptionSelected: { backgroundColor: Colors.softPink + '20' },
  attrOptionText: { fontSize: 15, color: Colors.warmDark },

  // Caption modal
  captionModalTitle: {
    fontFamily: 'DancingScript_700Bold',
    fontSize: 25,
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
