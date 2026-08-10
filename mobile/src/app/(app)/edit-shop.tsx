import { useState, useEffect, useCallback, useRef } from 'react'
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
import { Colors, CategoryColors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import LoadErrorState from '@/components/LoadErrorState'

const TREATMENT_CATEGORIES = [
  { name: 'Nails',     color: CategoryColors.nails },
  { name: 'Lashes',    color: CategoryColors.lashes },
  { name: 'Brows',     color: CategoryColors.brows },
  { name: 'Hair',      color: CategoryColors.hair },
  { name: 'Makeup',    color: CategoryColors.makeup },
  { name: 'Spray Tan', color: CategoryColors.sprayTan },
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

  /**
   * The provider_treatments rows as they exist in the database, category -> id.
   *
   * A ref, not state: nothing renders it, and it must reflect what was LOADED
   * rather than what is currently ticked — that difference is the whole basis
   * of the diff in handleSave.
   */
  const existingRows = useRef<Map<string, string>>(new Map())

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

        // Load existing treatment categories. The ids come too: a save is a
        // diff against these rows, and a row we keep must keep its id.
        const { data: treats } = await supabase
          .from('provider_treatments')
          .select('id, category')
          .eq('provider_id', pid)

        const rows = (treats ?? []) as { id: string; category: string | null }[]
        const byCategory = new Map<string, string>()
        for (const r of rows) {
          // First id wins. Duplicates exist on accounts that saved while the
          // old delete-all path was silently failing its delete — keeping the
          // first is arbitrary but stable, and the extras are left alone
          // rather than cleaned up here, because a booking may point at one.
          if (r.category && !byCategory.has(r.category)) byCategory.set(r.category, r.id)
        }
        existingRows.current = byCategory
        if (byCategory.size > 0) setSelectedCategories(new Set(byCategory.keys()))
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

  /**
   * Which booking is holding a treatment, in words a stylist can act on.
   *
   * Migration 0013 refuses the delete; the message it raises is for logs, not
   * for reading. Telling someone what is refused without telling them what
   * happens next is half an error, so this names the booking and says the
   * removal completes on its own.
   *
   * Mirrors 0013's predicate. If they drift, the delete is still correctly
   * refused and only the wording gets vaguer — hence a complete fallback
   * sentence rather than a placeholder.
   */
  const describeBlocker = async (treatmentId: string, category: string): Promise<string> => {
    // Mirrors 0015's predicate, date filter included. Without it the message
    // would name a booking from three weeks ago while the guard was actually
    // holding on a different one next week.
    const { data } = await supabase
      .from('sessions')
      .select('date, start_time, status')
      .eq('treatment_id', treatmentId)
      .in('status', ['pending', 'accepted'])
      .gte('date', new Date().toISOString().slice(0, 10))
      .order('date').order('start_time')
      .limit(1)
      .maybeSingle()

    const s = data as { date: string; start_time: string | null; status: string } | null
    if (!s) return `You can remove ${category} once the booking using it has passed.`

    const when = new Date(s.date + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    })
    const at = s.start_time ? ` at ${s.start_time.slice(0, 5)}` : ''
    const kind = s.status === 'pending' ? 'an application for' : 'a booking on'

    return (
      `There's ${kind} ${when}${at} using ${category}. ` +
      `It'll come off your list on its own once that day has passed — ` +
      `you don't need to do anything.`
    )
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

      /**
       * Treatments save as a DIFF. It used to delete every row and re-insert
       * the selection, which minted a new uuid for each category on every save.
       *
       * Those uuids are not private to this table: availability.active_treatments
       * is a uuid[] of them and sessions.treatment_id holds one. So pressing
       * Save while changing nothing detached every slot's treatment list and
       * left bookings pointing at rows that no longer existed — and because
       * apply-session.tsx falls back to "all current treatments" for a slot
       * that resolves to none, models were then offered treatments this stylist
       * had deliberately not enabled for that slot.
       *
       * Keeping a category means keeping its row, and therefore its id.
       * See supabase/migrations/0012 and mobile-treatments-orphan-bug.md.
       */
      const existing = existingRows.current
      const toAdd    = [...selectedCategories].filter(cat => !existing.has(cat))
      const toRemove = [...existing.entries()].filter(([cat]) => !selectedCategories.has(cat))

      if (toAdd.length > 0) {
        const { error: insError } = await supabase.from('provider_treatments').insert(
          toAdd.map(cat => ({ provider_id: providerId, name: cat, category: cat })),
        )
        if (insError) throw insError
      }

      // One at a time so a refusal can name the treatment. The old code ignored
      // its delete error entirely — then inserted anyway, duplicating rows and
      // reporting success.
      const blocked: string[] = []
      for (const [cat, id] of toRemove) {
        const { error: delError } = await supabase
          .from('provider_treatments').delete().eq('id', id).eq('provider_id', providerId)
        if (!delError) continue

        console.error('edit-shop: could not remove treatment', cat, delError)
        // 23503 is migration 0013 refusing because a live booking holds it.
        // Anything else is a real fault and must not be dressed up as one —
        // telling a stylist to wait for a booking to finish when the actual
        // cause was a permission error sends them to wait for nothing.
        blocked.push(
          delError.code === '23503'
            ? await describeBlocker(id, cat)
            : `${cat} couldn't be removed just now — try again in a moment.`,
        )
      }

      if (blocked.length > 0) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        Alert.alert('Saved, mostly', `Everything else saved.\n\n${blocked.join('\n\n')}`)
        setSaving(false)
        load()
        return
      }

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
        <ActivityIndicator color={Colors.rose} />
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
  title:   { fontFamily: Fonts.display, fontSize: 24, color: Colors.rose },

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
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.md,
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
    borderRadius: Radius.pill,
    borderWidth: 2,
    backgroundColor: Colors.inputBg,
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
    backgroundColor: Colors.rose,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },
  saveBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.white,
    letterSpacing: -0.2,
  },
})
