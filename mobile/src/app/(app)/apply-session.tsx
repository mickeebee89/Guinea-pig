import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { decode } from 'base64-arraybuffer'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, CategoryColors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { hasActiveSubscription, isIdentityVerified } from '@/lib/verification'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { ConsentGate } from '@/components/ConsentGate'
import AvailabilityCalendar, { dateKey } from '@/components/AvailabilityCalendar'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  Nails:       CategoryColors.nails,
  Lashes:      CategoryColors.lashes,
  Brows:       CategoryColors.brows,
  Hair:        CategoryColors.hair,
  Makeup:      CategoryColors.makeup,
  'Spray Tan': CategoryColors.sprayTan,
}

const TOTAL_STEPS = 7
const NOTE_MAX    = 300

const STEP_TITLES = [
  'Choose a date',
  'Pick a time',
  'Select a treatment',
  'Add a note',
  'Share photos',
  'Almost there',
  'Review & confirm',
]

const STEP_SUBS = [
  "Available dates are highlighted in rose — tap one to select",
  'Choose a time slot that works for you',
  "Pick the treatment you'd like",
  'Anything the stylist should know? (optional)',
  'Share photos to help the stylist prepare (optional)',
  'Please read and agree before confirming your application',
  'Check your details, then send your application',
]

// ── Types ─────────────────────────────────────────────────────────────────────

type AvailabilitySlot = { id: string; date: string; start_time: string; end_time: string; treatmentIds: string[] }
type Treatment        = { id: string; name: string; category: string }
type ExistingPhoto    = { id: string; photoUrl: string }
type PendingPhoto     = { uri: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function formatDateShort(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// Times may be stored as 'HH:MM' or 'HH:MM:SS'; the taken_slots RPC always returns
// 'HH:MM:SS'. Normalise both to 'HH:MM:SS' before comparing — the same rule
// availability.tsx uses for its (provider_id, date, start_time, end_time) unique key.
function toHHMMSS(t: string): string {
  return t && t.length === 5 ? `${t}:00` : t
}

// DB times come back as 'HH:MM:SS' — never show the raw value to a user.
// Mirrors fmtTime in sessions.tsx so both screens read '9:00am'.
function fmtTime(t: string): string {
  if (!t) return ''
  const [h, min] = t.split(':')
  const hour = parseInt(h, 10)
  if (isNaN(hour)) return t
  return `${hour % 12 || 12}:${min}${hour >= 12 ? 'pm' : 'am'}`
}

// Composite slot key so a taken booking matches its availability slot exactly.
function slotKey(startTime: string, endTime: string): string {
  return `${toHHMMSS(startTime)}|${toHHMMSS(endTime)}`
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ApplySessionScreen() {
  const { providerId, providerName, preDate } =
    useLocalSearchParams<{ providerId: string; providerName: string; preDate?: string }>()
  const router   = useRouter()
  const { session } = useAuth()
  const insets   = useSafeAreaInsets()
  const userId   = session?.user?.id
  const scrollRef = useRef<ScrollView>(null)

  const today    = useMemo(() => new Date(), [])
  const todayKey = useMemo(() => dateKey(today), [today])

  // ── Data state ─────────────────────────────────────────────────────────────

  const [loading,         setLoading]         = useState(true)
  const [availRows,       setAvailRows]       = useState<AvailabilitySlot[]>([])
  const [treatments,      setTreatments]      = useState<Treatment[]>([])
  const [existingPhotos,  setExistingPhotos]  = useState<ExistingPhoto[]>([])
  const [selectedPhotoIds,setSelectedPhotoIds]= useState<Set<string>>(new Set())
  const [pendingPhotos,   setPendingPhotos]   = useState<PendingPhoto[]>([])
  // URLs that already uploaded in a prior (aborted) submit attempt. Carried forward
  // so a retry re-uploads ONLY the failed photos while these still attach to the
  // booking — no duplicate bucket uploads or model_photos library rows.
  const [carriedPhotoUrls, setCarriedPhotoUrls] = useState<string[]>([])
  const [providerUserId,  setProviderUserId]  = useState<string | null>(null)
  // Taken slots for the selected date, from the server-side taken_slots RPC
  // (pending/accepted sessions only) — so we never read other users' sessions on the
  // client. Keyed by normalised `start|end`. takenError → conservative: treat all taken.
  const [takenSlotKeys,   setTakenSlotKeys]   = useState<Set<string>>(new Set())
  const [takenError,      setTakenError]      = useState<string | null>(null)
  // Bumped to force a taken_slots re-fetch for the same date (e.g. after a booking
  // conflict) so the just-taken slot flips to "Booked" without changing selectedDate.
  const [takenNonce,      setTakenNonce]      = useState(0)

  // ── Wizard state ───────────────────────────────────────────────────────────

  const [step,          setStep]         = useState<1|2|3|4|5|6|7>(preDate ? 2 : 1)
  const [selectedDate,  setSelectedDate] = useState<string | null>(preDate || null)
  const [selectedSlot,  setSelectedSlot] = useState<AvailabilitySlot | null>(null)
  const [selectedTreatId,setSelectedTreatId]= useState<string | null>(null)
  const [note,          setNote]         = useState('')
  const [submitting,    setSubmitting]   = useState(false)
  const [submitted,     setSubmitted]    = useState(false)
  const [patchTestAgreed, setPatchTestAgreed] = useState(false)

  // ── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!providerId || !userId) return
    async function load() {
      // Gate: models must have BOTH an active subscription AND identity verification.
      // Route to whichever step is missing (subscribe-first): no sub → subscribe;
      // subscribed but unverified → verify-payment; both → proceed.
      try {
        const [subscribed, verified] = await Promise.all([
          hasActiveSubscription(userId!),
          isIdentityVerified(userId!),
        ])
        if (!subscribed) {
          router.replace({
            pathname: '/(app)/subscribe' as any,
            params:   { providerId, providerName },
          })
          return
        }
        if (!verified) {
          // Carry provider context so the pending screen can offer "add to favourites".
          router.replace({
            pathname: '/(app)/verify-payment' as any,
            params:   { providerId, providerName },
          })
          return
        }
      } catch (e) {
        console.error('apply-session gate check failed:', e)
        router.replace({
          pathname: '/(app)/subscribe' as any,
          params:   { providerId, providerName },
        })
        return
      }

      try {
        const [{ data: availData, error: availError }, { data: treatData, error: treatError }, { data: provData }] = await Promise.all([
          supabase
            .from('availability')
            .select('id, date, start_time, end_time, active_treatments')
            .eq('provider_id', providerId)
            .gte('date', todayKey)
            .order('date'),
          supabase
            .from('provider_treatments')
            .select('id, name, category')
            .eq('provider_id', providerId),
          supabase
            .from('providers')
            .select('user_id')
            .eq('id', providerId)
            .single(),
        ])
        if (availData) setAvailRows((availData as any[]).map(r => ({
          id:           r.id,
          date:         r.date,
          start_time:   r.start_time,
          end_time:     r.end_time,
          // Per-slot treatment scoping (mirror availability.tsx's treatmentIds).
          treatmentIds: (r.active_treatments as string[] | null) ?? [],
        })))
        if (treatData) setTreatments(treatData as Treatment[])
        if (provData)  setProviderUserId((provData as any).user_id ?? null)
      } catch {}

      try {
        const { data: photoData } = await supabase
          .from('model_photos')
          .select('id, photo_url')
          .eq('user_id', userId)
        if (photoData) {
          setExistingPhotos(photoData.map((p: any) => ({ id: p.id, photoUrl: p.photo_url })))
        }
      } catch {}

      setLoading(false)
    }
    load()
  }, [providerId, userId, todayKey])

  // Which of this provider's slots are already taken on the selected date. Uses the
  // server-side taken_slots RPC (pending/accepted only) instead of reading others'
  // sessions, so the sessions table can be locked down to participants.
  useEffect(() => {
    if (!providerId || !selectedDate) {
      setTakenSlotKeys(new Set())
      setTakenError(null)
      return
    }
    let cancelled = false
    setTakenError(null)
    ;(async () => {
      const { data, error } = await supabase.rpc('taken_slots', {
        p_provider_id: providerId,
        p_date:        selectedDate,
      })
      if (cancelled) return
      if (error) {
        // Surface, don't swallow. Conservative: with availability unverifiable, flag
        // every slot taken so a booked slot can never be shown as free.
        console.error('taken_slots RPC failed:', error)
        setTakenError(error.message ?? 'Could not check slot availability')
        setTakenSlotKeys(new Set())
        return
      }
      const rows = (data ?? []) as { start_time: string; end_time: string }[]
      setTakenSlotKeys(new Set(rows.map(r => slotKey(r.start_time, r.end_time))))
    })()
    return () => { cancelled = true }
  }, [providerId, selectedDate, takenNonce])

  // ── Derived ────────────────────────────────────────────────────────────────

  const availDateSet = useMemo(() => new Set(availRows.map(r => r.date)), [availRows])

  const slotsForDate = useMemo(
    () => availRows.filter(r => r.date === selectedDate),
    [availRows, selectedDate]
  )

  // A slot is unavailable if the RPC reported it taken, or if the RPC errored (we then
  // treat every slot as taken rather than risk showing a booked slot as free).
  const isSlotTaken = (slot: AvailabilitySlot): boolean =>
    takenError != null || takenSlotKeys.has(slotKey(slot.start_time, slot.end_time))

  // Treatments a given slot actually supports. Mirrors availability.tsx:602
  // (slotTreats = dayTreats.filter(t => slot.treatmentIds.includes(t.id))).
  // Backward-compat: a slot with empty/null active_treatments (created before per-slot
  // scoping existed) falls back to the provider's full list rather than showing none.
  const treatmentsForSlot = useCallback((slot: AvailabilitySlot): Treatment[] => {
    if (!slot.treatmentIds || slot.treatmentIds.length === 0) return treatments
    const scoped = treatments.filter(t => slot.treatmentIds.includes(t.id))
    // Fall back to all treatments if the slot's active_treatments are stale/orphaned
    // (treatments deleted + recreated → those IDs no longer exist), otherwise the slot
    // dead-ends with "No treatments listed" and the model can't apply.
    return scoped.length > 0 ? scoped : treatments
  }, [treatments])

  const treatmentsInSlot = useMemo(
    () => selectedSlot ? treatmentsForSlot(selectedSlot) : [],
    [selectedSlot, treatmentsForSlot]
  )

  const selectedTreatment = useMemo(
    () => treatments.find(t => t.id === selectedTreatId) ?? null,
    [treatments, selectedTreatId]
  )

  const canNext = useMemo(() => {
    switch (step) {
      case 1: return selectedDate !== null
      case 2: return selectedSlot !== null
      case 3: return selectedTreatId !== null
      case 4:
      case 5: return true
      default: return false
    }
  }, [step, selectedDate, selectedSlot, selectedTreatId])

  const totalShareCount = selectedPhotoIds.size + pendingPhotos.length

  // ── Navigation handlers ────────────────────────────────────────────────────

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (step > 1) {
      setStep(s => (s - 1) as 1|2|3|4|5|6|7)
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    } else {
      router.back()
    }
  }

  const goNext = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setStep(s => (s + 1) as 2|3|4|5|6|7)
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }

  const handleConsentAccept = () => {
    setStep(7)
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }

  // ── Selection handlers ─────────────────────────────────────────────────────

  const selectDate = async (key: string) => {
    if (!availDateSet.has(key)) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedDate(key)
    setSelectedSlot(null)
    setSelectedTreatId(null)
  }

  const selectSlot = async (slot: AvailabilitySlot) => {
    if (isSlotTaken(slot)) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedSlot(slot)
    setSelectedTreatId(null)
  }

  const selectTreatment = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedTreatId(id)
  }

  // ── Photo handlers ─────────────────────────────────────────────────────────

  const toggleExistingPhoto = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedPhotoIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

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
    if (!result.canceled && result.assets.length > 0) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      setPendingPhotos(prev => [...prev, ...result.assets.map(a => ({ uri: a.uri }))])
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!userId || !providerId || !selectedDate || !selectedSlot || !selectedTreatId) return
    setSubmitting(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    try {
      // The selected slot is a real `availability` row; use its id directly.
      const resolvedAvailId = selectedSlot.id
      // Upload pending photos. Seed with any URLs that already uploaded in a prior
      // aborted attempt (carriedPhotoUrls) so they attach without re-uploading. Track
      // the photos that FAIL by reference so a retry can re-upload only those.
      const uploadedUrls: string[] = [...carriedPhotoUrls]
      const failedPhotos: PendingPhoto[] = []
      for (const photo of pendingPhotos) {
        try {
          const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
          const manipulated = await ImageManipulator.manipulateAsync(photo.uri, [], { base64: true })
          const { data: up, error: upErr } = await supabase.storage
            .from('model-photos')
            .upload(fileName, decode(manipulated.base64!), { contentType: 'image/jpeg' })
          if (upErr || !up) {
            console.error('apply-session: photo upload failed:', upErr)
            failedPhotos.push(photo)
            continue
          }
          const { data: urlData } = supabase.storage.from('model-photos').getPublicUrl(up.path)
          uploadedUrls.push(urlData.publicUrl)
          // Saving to the reusable photo library is best-effort: the URL is already
          // attached to this booking above, so a library-insert failure isn't a lost
          // photo — log it but don't count it as a failed upload.
          const { error: libErr } = await supabase.from('model_photos').insert({ user_id: userId, photo_url: urlData.publicUrl })
          if (libErr) console.error('apply-session: model_photos library insert failed:', libErr)
        } catch (e) {
          console.error('apply-session: photo upload threw:', e)
          failedPhotos.push(photo)
        }
      }

      // Some attached photos couldn't be uploaded — never submit without them
      // silently. Let the model choose: proceed without the failed photos, or back
      // out and retry. The booking itself is unaffected either way.
      if (failedPhotos.length > 0) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        const proceedWithout = await new Promise<boolean>(resolve => {
          Alert.alert(
            'Couldn’t upload your photos',
            `${failedPhotos.length} photo${failedPhotos.length > 1 ? 's' : ''} couldn’t be uploaded. Submit your application without ${failedPhotos.length > 1 ? 'them' : 'it'}, or go back and try again?`,
            [
              { text: 'Try again',       style: 'cancel',      onPress: () => resolve(false) },
              { text: 'Submit without',  style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: false },
          )
        })
        if (!proceedWithout) {
          // Abort: keep ONLY the failed photos pending (the succeeded ones are already
          // in the bucket + library), and carry their URLs forward so the next submit
          // re-uploads just the failures and still attaches the successes.
          setPendingPhotos(failedPhotos)
          setCarriedPhotoUrls(uploadedUrls)
          setSubmitting(false)
          return
        }
      }

      const selectedExistingUrls = existingPhotos
        .filter(p => selectedPhotoIds.has(p.id))
        .map(p => p.photoUrl)
      const allPhotoUrls = [...selectedExistingUrls, ...uploadedUrls]

      const payload = {
        provider_id:      providerId,
        model_user_id:    userId,
        model_id:         userId,
        availability_id:  resolvedAvailId,
        date:             selectedDate,
        start_time:       selectedSlot.start_time,
        end_time:         selectedSlot.end_time,
        scheduled_at:     `${selectedDate}T${selectedSlot.start_time}`,
        duration_minutes: (() => {
          const [sh, sm] = selectedSlot.start_time.split(':').map(Number)
          const [eh, em] = selectedSlot.end_time.split(':').map(Number)
          return (eh * 60 + em) - (sh * 60 + sm)
        })(),
        treatment_id:     selectedTreatId,
        location_type:    'either',
        note:             note.trim() || null,
        photo_urls:       allPhotoUrls.length > 0 ? allPhotoUrls : null,
        status:           'pending',
      }

      const { data, error } = await supabase
        .from('sessions')
        .insert(payload)
        .select('id')
        .single()

      const sessionData = data
      const sessionErr  = error

      // Lost the race for this slot: the partial unique index (sessions_active_slot_uniq)
      // rejected a second active booking for the same provider+date+start_time. Show a
      // friendly nudge, refresh taken_slots so the slot flips to "Booked", and drop the
      // model back on the time step to pick another — never a raw DB error or silent fail.
      if (sessionErr?.code === '23505') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        setSelectedSlot(null)
        setTakenNonce(n => n + 1)
        setStep(2)
        Alert.alert(
          'That time was just booked',
          'Someone grabbed this slot moments ago — please choose another time.',
        )
        return
      }

      let consentErr: any = null
      if (providerUserId && sessionData) {
        const notifPayload = {
          user_id:    providerUserId,
          type:       'session_applied',
          title:      'New treatment application',
          body:       `A model has applied for ${selectedTreatment?.name ?? 'a treatment'} on ${formatDateShort(selectedDate)} at ${fmtTime(selectedSlot.start_time)}`,
          // session_id must be TOP-LEVEL so tap/deep-link + the Leave-review CTA can read
          // n.session_id (matches the model-directed inserts). Unread is tracked by read_at
          // (null = unread) — there is NO `read` column, so we don't set one.
          session_id: sessionData.id,
          data:       { provider_id: providerId },
        }
        const { error: notifErr } = await supabase.from('notifications').insert(notifPayload)
        if (notifErr) console.error('session_applied notification insert failed:', notifErr)
        consentErr = notifErr
      }
      if (sessionErr) throw sessionErr

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setSubmitted(true)
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Could not submit', err?.message ?? 'Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <View style={[styles.container, styles.successContainer]}>
        <View style={[styles.successInner, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark-circle" size={64} color={Colors.rose} />
          </View>
          <Text style={styles.successTitle}>Application sent!</Text>
          <Text style={styles.successSub}>
            Your application has been sent to {providerName ? providerName : 'the provider'}.{'\n'}
            You'll be notified when they respond.
          </Text>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.back()}
            activeOpacity={0.9}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  const progressPct = `${Math.round((step / TOTAL_STEPS) * 100)}%` as const

  return (
    <View style={styles.container}>
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.rose} />
          <Text style={styles.backText}>{step > 1 ? 'Back' : 'Cancel'}</Text>
        </TouchableOpacity>
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressPct }]} />
          </View>
          <Text style={styles.progressLabel}>{step}/{TOTAL_STEPS}</Text>
        </View>
      </View>

      {/* ── Step header ── */}
      <View style={styles.stepHeader}>
        <Text style={styles.stepLabel}>Step {step} of {TOTAL_STEPS}</Text>
        <Text style={styles.stepTitle}>{STEP_TITLES[step - 1]}</Text>
        <Text style={styles.stepSub}>{STEP_SUBS[step - 1]}</Text>
      </View>

      {/* ── Content ── */}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >

        {/* ════ STEP 1 — DATE ══════════════════════════════════════════════ */}
        {step === 1 && (
          loading ? (
            <View style={[styles.card, styles.centred]}>
              <Text style={styles.loadingText}>Loading availability…</Text>
            </View>
          ) : availRows.length === 0 ? (
            <View style={[styles.card, styles.centred, { paddingVertical: 32 }]}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.emptyTitle}>No availability yet</Text>
              <Text style={styles.emptySub}>
                This stylist hasn't added any availability yet. Check back soon!
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              <AvailabilityCalendar
                availableDates={availDateSet}
                todayKey={todayKey}
                selectedDate={selectedDate}
                onSelectDate={selectDate}
              />
              {selectedDate && (
                <View style={styles.selectionBanner}>
                  <Ionicons name="calendar-outline" size={14} color={Colors.rose} />
                  <Text style={styles.selectionText}>{formatDayLabel(selectedDate)}</Text>
                </View>
              )}
            </View>
          )
        )}

        {/* ════ STEP 2 — TIME SLOTS ════════════════════════════════════════ */}
        {step === 2 && (
          <View style={styles.card}>
            {takenError && (
              <Text style={styles.slotErrorHint}>
                Couldn't check slot availability. To avoid double-booking, slots are shown as
                unavailable — go back and try again.
              </Text>
            )}
            {slotsForDate.length === 0 ? (
              <Text style={styles.emptyHint}>No time slots available for this date.</Text>
            ) : (
              slotsForDate.map((slot) => {
                const isSelected = selectedSlot?.id === slot.id
                const taken      = isSlotTaken(slot)
                const slotTreats = treatmentsForSlot(slot)
                return (
                  <TouchableOpacity
                    key={slot.id}
                    style={[styles.slotPill, isSelected && styles.slotPillSelected, taken && styles.slotPillTaken]}
                    onPress={() => selectSlot(slot)}
                    disabled={taken}
                    activeOpacity={0.85}
                  >
                    <View style={styles.slotTimeWrap}>
                      <Ionicons
                        name="time-outline"
                        size={16}
                        color={isSelected && !taken ? Colors.rose : Colors.muted}
                      />
                      <Text style={[styles.slotTimeText, isSelected && !taken && styles.slotTimeTextSelected, taken && styles.slotTimeTextTaken]}>
                        {fmtTime(slot.start_time)} – {fmtTime(slot.end_time)}
                      </Text>
                    </View>
                    {taken ? (
                      <View style={styles.slotStripes}>
                        <Text style={styles.slotTakenLabel}>Booked</Text>
                      </View>
                    ) : (
                      <View style={styles.slotStripes}>
                        {slotTreats.map(t => {
                          const color = CATEGORY_COLOR[t.category] ?? Colors.muted
                          return (
                            <View key={t.id} style={[styles.slotStripe, { backgroundColor: color }]}>
                              <Text style={styles.slotStripeText}>{t.category}</Text>
                            </View>
                          )
                        })}
                      </View>
                    )}
                    {isSelected && !taken && (
                      <Ionicons name="checkmark-circle" size={22} color={Colors.rose} />
                    )}
                  </TouchableOpacity>
                )
              })
            )}
          </View>
        )}

        {/* ════ STEP 3 — TREATMENT ═════════════════════════════════════════ */}
        {step === 3 && (
          <View style={styles.card}>
            {treatmentsInSlot.length === 0 ? (
              <Text style={styles.emptyHint}>No treatments listed for this slot.</Text>
            ) : (
              <View style={styles.chipGrid}>
                {treatmentsInSlot.map(t => {
                  const active = selectedTreatId === t.id
                  const color  = CATEGORY_COLOR[t.category] ?? Colors.muted
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[
                        styles.treatChip,
                        active
                          ? { backgroundColor: color, borderColor: color }
                          : { borderColor: color },
                      ]}
                      onPress={() => selectTreatment(t.id)}
                      activeOpacity={0.75}
                    >
                      {active && (
                        <Ionicons name="checkmark" size={13} color={Colors.white} style={{ marginRight: 5 }} />
                      )}
                      <Text style={[styles.treatChipText, { color: active ? Colors.white : color }]}>
                        {t.name}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}
          </View>
        )}

        {/* ════ STEP 4 — NOTE ══════════════════════════════════════════════ */}
        {step === 4 && (
          <View style={styles.card}>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={t => setNote(t.slice(0, NOTE_MAX))}
              placeholder="Anything the provider should know?"
              placeholderTextColor={Colors.muted}
              multiline
              textAlignVertical="top"
              maxLength={NOTE_MAX}
            />
            <Text style={styles.noteCounter}>{note.length}/{NOTE_MAX}</Text>
          </View>
        )}

        {/* ════ STEP 5 — PHOTOS ════════════════════════════════════════════ */}
        {step === 5 && (
          <>
            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.rose} />
              <Text style={styles.infoText}>
                Photos help the provider prepare their tools and materials. You choose what to share.
              </Text>
            </View>

            <View style={styles.card}>
              {existingPhotos.length === 0 && pendingPhotos.length === 0 ? (
                <View style={styles.photoEmptyState}>
                  <Ionicons name="images-outline" size={44} color={Colors.muted} />
                  <Text style={styles.photoEmptyTitle}>No photos yet</Text>
                  <Text style={styles.photoEmptySub}>
                    Add photos from your library to share with the provider.
                  </Text>
                </View>
              ) : (
                <View style={styles.photoGrid}>
                  {existingPhotos.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.photoThumb, selectedPhotoIds.has(p.id) && styles.photoThumbSelected]}
                      onPress={() => toggleExistingPhoto(p.id)}
                      activeOpacity={0.85}
                    >
                      <Image source={{ uri: p.photoUrl }} style={styles.photoImg} resizeMode="cover" />
                      {selectedPhotoIds.has(p.id) && (
                        <View style={styles.photoCheckOverlay}>
                          <Ionicons name="checkmark-circle" size={22} color={Colors.white} />
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                  {pendingPhotos.map((p, i) => (
                    <View key={`pending-${i}`} style={[styles.photoThumb, styles.photoThumbSelected]}>
                      <Image source={{ uri: p.uri }} style={styles.photoImg} resizeMode="cover" />
                      <View style={styles.photoCheckOverlay}>
                        <Ionicons name="checkmark-circle" size={22} color={Colors.white} />
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={styles.addPhotoBtn}
                onPress={addPhotos}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle-outline" size={20} color={Colors.rose} />
                <Text style={styles.addPhotoText}>Add photos from library</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ════ STEP 6 — CONSENT ═══════════════════════════════════════════ */}
        {step === 6 && (
          <ConsentGate onAccept={handleConsentAccept} />
        )}

        {/* ════ STEP 7 — CONFIRMATION ══════════════════════════════════════ */}
        {step === 7 && selectedDate && selectedSlot && selectedTreatment && (
          <>
          <View style={styles.card}>
            <Text style={styles.confirmSectionTitle}>Treatment details</Text>

            <ConfirmRow icon="person-outline"   label="Provider"  value={providerName ?? ''} />
            <ConfirmRow icon="calendar-outline" label="Date"      value={formatDayLabel(selectedDate)} />
            <ConfirmRow icon="time-outline"     label="Time"      value={`${fmtTime(selectedSlot.start_time)} – ${fmtTime(selectedSlot.end_time)}`} />

            {/* Treatment — special row with colour stripe */}
            <View style={styles.confirmRow}>
              <Ionicons name="sparkles-outline" size={18} color={Colors.muted} style={styles.confirmRowIcon} />
              <Text style={styles.confirmLabel}>Treatment</Text>
              <View style={styles.confirmTreatWrap}>
                <View style={[
                  styles.confirmTreatStripe,
                  { backgroundColor: CATEGORY_COLOR[selectedTreatment.category] ?? Colors.muted },
                ]} />
                <Text style={styles.confirmValue}>{selectedTreatment.name}</Text>
              </View>
            </View>

            {note.trim() ? (
              <ConfirmRow icon="chatbubble-outline" label="Note"   value={note.trim()} multiline />
            ) : (
              <ConfirmRow icon="chatbubble-outline" label="Note"   value="No note added" muted />
            )}

            {totalShareCount > 0 ? (
              <ConfirmRow
                icon="images-outline"
                label="Photos"
                value={`${totalShareCount} photo${totalShareCount !== 1 ? 's' : ''} to share`}
              />
            ) : (
              <ConfirmRow icon="images-outline" label="Photos" value="No photos shared" muted />
            )}
          </View>

          <TouchableOpacity
            style={[styles.patchTestRow, patchTestAgreed && styles.patchTestRowAgreed]}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setPatchTestAgreed(v => !v)
            }}
            activeOpacity={0.8}
          >
            <Ionicons
              name={patchTestAgreed ? 'checkbox' : 'square-outline'}
              size={22}
              color={patchTestAgreed ? Colors.rose : Colors.muted}
            />
            <Text style={styles.patchTestText}>
              A patch test may be required before some treatments. Please book with enough time in advance for one to be carried out if needed.
            </Text>
          </TouchableOpacity>
          </>
        )}

        {/* Step 7 with an incomplete selection would otherwise render an empty screen
           behind a permanently-disabled Confirm button — give a way back instead. */}
        {step === 7 && !(selectedDate && selectedSlot && selectedTreatment) && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Something's missing</Text>
            <Text style={styles.emptySub}>
              We lost part of your booking details. Go back and pick your date, time and treatment again.
            </Text>
            <TouchableOpacity
              style={[styles.actionBtn, { marginTop: 16 }]}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setStep(1)
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.actionBtnText}>Start again</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Bottom bar (hidden for step 6 — ConsentGate has its own button) ── */}
      {step !== 6 && (
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {step < 7 ? (
            <TouchableOpacity
              style={[styles.actionBtn, !canNext && styles.actionBtnDisabled]}
              disabled={!canNext}
              onPress={goNext}
              activeOpacity={0.9}
            >
              <Text style={styles.actionBtnText}>Next</Text>
              <Ionicons name="arrow-forward" size={18} color={Colors.white} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, (submitting || !patchTestAgreed) && styles.actionBtnDisabled]}
              disabled={submitting || !patchTestAgreed}
              onPress={handleSubmit}
              activeOpacity={0.9}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
              <Text style={styles.actionBtnText}>
                {submitting ? 'Sending…' : 'Confirm application'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfirmRow({
  icon,
  label,
  value,
  muted     = false,
  multiline = false,
}: {
  icon: string
  label: string
  value: string
  muted?: boolean
  multiline?: boolean
}) {
  return (
    <View style={[styles.confirmRow, multiline && { alignItems: 'flex-start' }]}>
      <Ionicons name={icon as any} size={18} color={Colors.muted} style={styles.confirmRowIcon} />
      <Text style={styles.confirmLabel}>{label}</Text>
      <Text style={[
        styles.confirmValue,
        muted && styles.confirmValueMuted,
        multiline && { flex: 1 },
      ]}>
        {value}
      </Text>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },

  // Success
  successContainer: { justifyContent: 'center' },
  successInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.softPink + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontFamily: Fonts.display,
    fontSize: 32,
    color: Colors.rose,
    letterSpacing: -0.5,
    marginBottom: 10,
    textAlign: 'center',
  },
  successSub: {
    fontSize: 15,
    color: Colors.muted,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
  },
  doneBtn: {
    backgroundColor: Colors.rose,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    paddingHorizontal: 56,
    ...Shadow.card,
  },
  doneBtnText: {
    fontSize: 16,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingRight: 10,
  },
  backText: {
    fontSize: 15,
    color: Colors.rose,
    fontFamily: Fonts.body,
  },
  progressWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.rose,
    borderRadius: 2,
  },
  progressLabel: {
    fontSize: 12,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    minWidth: 28,
    textAlign: 'right',
  },

  // Step header
  stepHeader: {
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  stepLabel: {
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
    color: Colors.rose,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  stepTitle: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.rose,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  stepSub: {
    fontSize: 14,
    color: Colors.muted,
    lineHeight: 20,
  },

  scroll: { paddingHorizontal: 16 },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.soft,
  },
  centred: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.softPink,
    borderRadius: Radius.md,
    padding: 14,
    marginBottom: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.warmDark,
    lineHeight: 19,
    opacity: 0.85,
  },

  loadingText: { fontSize: 15, color: Colors.muted },

  emptyEmoji: { fontSize: 40, marginBottom: 10 },
  emptyTitle: {
    fontSize: 17,
    fontFamily: Fonts.heading,
    color: Colors.warmDark,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
  emptyHint: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    paddingVertical: 12,
  },

  selectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  selectionText: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.rose,
  },

  // Slot pills
  slotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.md,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: 10,
  },
  slotPillSelected: {
    borderColor: Colors.rose,
    backgroundColor: Colors.softPink,
  },
  slotPillTaken: {
    opacity: 0.55,
    backgroundColor: Colors.inputBg,
  },
  slotTimeTextTaken: {
    color: Colors.muted,
    textDecorationLine: 'line-through',
  },
  slotTakenLabel: {
    fontSize: 12,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slotErrorHint: {
    fontSize: 13,
    color: Colors.error,
    marginBottom: 12,
    lineHeight: 18,
  },
  slotTimeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 106,
  },
  slotTimeText: {
    fontSize: 15,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
  },
  slotTimeTextSelected: {
    color: Colors.rose,
  },
  slotStripes: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  slotStripe: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  slotStripeText: {
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
  },

  // Treatment chips
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  treatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  treatChipText: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
  },

  // Note
  noteInput: {
    fontSize: 15,
    color: Colors.warmDark,
    lineHeight: 22,
    minHeight: 120,
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteCounter: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'right',
    marginTop: 6,
  },

  // Photos
  photoEmptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  photoEmptyTitle: {
    fontSize: 16,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
  },
  photoEmptySub: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 220,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  photoThumb: {
    width: 90,
    height: 90,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  photoThumbSelected: {
    borderColor: Colors.rose,
  },
  photoImg: {
    width: '100%',
    height: '100%',
  },
  photoCheckOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  addPhotoText: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: Colors.rose,
  },

  // Confirmation
  confirmSectionTitle: {
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  confirmRowIcon: { flexShrink: 0 },
  confirmLabel: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    width: 72,
    flexShrink: 0,
  },
  confirmValue: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.body,
    color: Colors.warmDark,
  },
  confirmValueMuted: {
    color: Colors.muted,
    fontStyle: 'italic',
  },
  confirmTreatWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmTreatStripe: {
    width: 4,
    height: 18,
    borderRadius: 2,
    flexShrink: 0,
  },

  // Patch-test disclaimer
  patchTestRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.rose,
    backgroundColor: Colors.softPink + '40',
  },
  patchTestRowAgreed: {
    borderColor: Colors.rose,
    backgroundColor: Colors.softPink + '66',
  },
  patchTestText: {
    flex: 1,
    fontSize: 13,
    color: Colors.warmDark,
    lineHeight: 19,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.cream,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 6,
  },
  actionBtn: {
    backgroundColor: Colors.rose,
    borderRadius: Radius.lg,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...Shadow.card,
  },
  actionBtnDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  actionBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontFamily: Fonts.bodyBold,
    letterSpacing: -0.2,
  },
})
