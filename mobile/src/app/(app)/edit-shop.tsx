import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors, CategoryColors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import LoadErrorState from '@/components/LoadErrorState'

const TREATMENT_CATEGORIES = [
  { name: 'Nails',     color: CategoryColors.nails },
  { name: 'Lashes',    color: '#1D9E75' },
  { name: 'Brows',     color: '#BA7517' },
  { name: 'Hair',      color: '#7B5EA7' },
  { name: 'Makeup',    color: '#E8845E' },
  { name: 'Spray Tan', color: '#C99A4E' },
]

export default function EditShopScreen() {
  const router = useRouter()
  const { session } = useAuth()
  const userId = session?.user?.id

  const [providerId,         setProviderId]         = useState<string | null>(null)
  const [name,               setName]               = useState('')
  const [bio,                setBio]                = useState('')
  const [locationText,       setLocationText]       = useState('')
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())
  const [loading,            setLoading]            = useState(true)
  const [loadError,          setLoadError]          = useState(false)
  const [saving,             setSaving]             = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setLoadError(false)
    try {
      const { data: prov } = await supabase
        .from('providers')
        .select('id, name, bio, location_text')
        .eq('user_id', userId)
        .single()

      if (prov) {
        const pid = (prov as any).id as string
        setProviderId(pid)
        setName((prov as any).name ?? '')
        setBio((prov as any).bio ?? '')
        setLocationText((prov as any).location_text ?? '')

        // Load existing treatment categories
        const { data: treats } = await supabase
          .from('provider_treatments')
          .select('category')
          .eq('provider_id', pid)
        if (treats && treats.length > 0) {
          setSelectedCategories(new Set((treats as any[]).map(t => t.category as string)))
        }
      }
    } catch (e) {
      console.error('edit-shop load failed:', e)
      setLoadError(true)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  const toggleCategory = async (cat: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedCategories(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  const handleSave = async () => {
    if (!providerId) return
    if (selectedCategories.size === 0) {
      Alert.alert(
        'Add at least one treatment',
        'Models need to know what you offer before you can save your profile. Select the treatments you provide.',
      )
      return
    }
    setSaving(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    try {
      // Save provider bio/location
      const { error: provErr } = await supabase
        .from('providers')
        .update({
          name:          name.trim(),
          bio:           bio.trim(),
          location_text: locationText.trim(),
        })
        .eq('id', providerId)
      if (provErr) throw provErr

      // Save treatments: delete all then re-insert selected
      const { error: delError } = await supabase.from('provider_treatments').delete().eq('provider_id', providerId)
      const rows = [...selectedCategories].map(cat => ({
        provider_id: providerId,
        name:        cat,
        category:    cat,
      }))
      const { error: insError } = selectedCategories.size > 0
        ? await supabase.from('provider_treatments').insert(rows)
        : { error: null }
      if (insError) throw insError

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.back()
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Save failed', e?.message ?? 'Could not save. Please try again.')
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <LoadErrorState onRetry={() => load()} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.75}>
              <Ionicons name="arrow-back" size={24} color={Colors.warmDark} />
            </TouchableOpacity>
            <Text style={styles.title}>Edit Shop</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your stylist name"
              placeholderTextColor={Colors.muted}
              maxLength={80}
            />

            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell models about yourself, your specialties, and your studio…"
              placeholderTextColor={Colors.muted}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              maxLength={500}
            />

            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.input}
              value={locationText}
              onChangeText={setLocationText}
              placeholder="e.g. Shoreditch, London"
              placeholderTextColor={Colors.muted}
              maxLength={120}
            />

            <Text style={styles.label}>Treatments you offer</Text>
            <Text style={styles.labelSub}>Select all that apply</Text>
            <View style={styles.categoryGrid}>
              {TREATMENT_CATEGORIES.map(cat => {
                const selected = selectedCategories.has(cat.name)
                return (
                  <TouchableOpacity
                    key={cat.name}
                    style={[
                      styles.categoryChip,
                      selected
                        ? { backgroundColor: cat.color, borderColor: cat.color }
                        : { borderColor: cat.color },
                    ]}
                    onPress={() => toggleCategory(cat.name)}
                    activeOpacity={0.8}
                  >
                    <Text style={[
                      styles.categoryChipText,
                      selected ? styles.categoryChipTextSelected : { color: cat.color },
                    ]}>
                      {cat.name}
                    </Text>
                    {selected && (
                      <Ionicons name="checkmark" size={14} color={Colors.white} style={{ marginLeft: 4 }} />
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.65 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.9}
            >
              {saving
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.saveBtnText}>Save changes</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  safe:      { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.white,
  },
  backBtn: { padding: 4 },
  title:   { fontFamily: 'DancingScript_700Bold', fontSize: 26, color: Colors.warmDark },

  scroll: { paddingHorizontal: 20, paddingBottom: 48 },

  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.warmDark,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 8,
  },
  labelSub: {
    fontSize: 13,
    color: Colors.muted,
    marginTop: -6,
    marginBottom: 10,
  },
  input: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.warmDark,
  },
  textarea: {
    height: 120,
    paddingTop: 12,
  },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 2,
    backgroundColor: Colors.white,
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  categoryChipTextSelected: {
    color: Colors.white,
  },

  saveBtn: {
    marginTop: 36,
    height: 54,
    backgroundColor: Colors.roseDark,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: -0.2,
  },
})
