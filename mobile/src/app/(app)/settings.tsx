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
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { decode } from 'base64-arraybuffer'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import ScreenDecor from '@/components/ScreenDecor'
import LoadErrorState from '@/components/LoadErrorState'

// ── Types ─────────────────────────────────────────────────────────────────────

type UserRole = 'model' | 'provider' | 'both' | null

type UserData = {
  first_name:                string
  last_initial:              string | null
  email:                     string
  role:                      UserRole
  profile_pic_url:           string | null
  is_verified:               boolean | null
  subscription_status:       string | null
  subscription_next_billing: string | null
  subscription_waived:       boolean | null
}

type VerifStatus = 'none' | 'pending' | 'approved' | 'declined'
type EditField   = 'bio'

// ── Constants ─────────────────────────────────────────────────────────────────


const LEGAL_LINKS = [
  { label: 'Terms of Service',   icon: 'document-outline',  url: 'https://guineapigapp.co.uk/terms'     },
  { label: 'Community Rules',    icon: 'people-outline',    url: 'https://guineapigapp.co.uk/community' },
  { label: 'Privacy Policy',     icon: 'eye-off-outline',   url: 'https://guineapigapp.co.uk/privacy'   },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function editLabel(f: EditField): string {
  return { bio: 'Bio' }[f]
}

function editMaxLength(f: EditField): number {
  return { bio: 400 }[f]
}

function editPlaceholder(f: EditField): string {
  return {
    bio: 'Tell models about your space, specialties, and what to expect from a treatment…',
  }[f]
}

function subscriptionLabel(status: string | null | undefined) {
  switch (status) {
    case 'premium':   return { text: '✨ Premium',  color: Colors.roseDark }
    case 'pro':       return { text: '🌟 Pro',      color: Colors.rose     }
    case 'active':     return { text: '✨ Premium',  color: Colors.roseDark }
    case 'trialling':  return { text: '✨ Premium (trial)', color: Colors.roseDark }
    case 'cancelling': return { text: 'Cancelling',  color: Colors.muted    }
    default:           return { text: 'Free Plan',   color: Colors.muted    }   // none / cancelled / null
  }
}

function formatBillingDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Row components ────────────────────────────────────────────────────────────

function Row({
  label, value, icon, onPress, danger, last, rightEl,
}: {
  label: string
  value?: string
  icon?: string
  onPress?: () => void
  danger?: boolean
  last?: boolean
  rightEl?: React.ReactNode
}) {
  const inner = (
    <View style={[rowSt.row, !last && rowSt.rowBorder]}>
      {icon && (
        <View style={[rowSt.iconWrap, danger && { backgroundColor: Colors.inputBg }]}>
          <Ionicons name={icon as any} size={17} color={danger ? Colors.error : Colors.rose} />
        </View>
      )}
      <Text style={[rowSt.label, danger && { color: Colors.error }]}>{label}</Text>
      {rightEl ?? (
        <>
          {value !== undefined && (
            <Text style={rowSt.value} numberOfLines={1}>{value}</Text>
          )}
          {onPress && <Ionicons name="chevron-forward" size={15} color={Colors.muted} />}
        </>
      )}
    </View>
  )
  return onPress
    ? <TouchableOpacity onPress={onPress} activeOpacity={0.8}>{inner}</TouchableOpacity>
    : inner
}

const rowSt = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
    minHeight: 52,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.softPink + '40',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  value: {
    fontSize: 13,
    color: Colors.muted,
    maxWidth: 160,
    flexShrink: 1,
  },
})

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const router  = useRouter()
  const { session, signOut } = useAuth()
  const insets  = useSafeAreaInsets()
  const userId  = session?.user?.id

  // ── Core state ─────────────────────────────────────────────────────────────

  const [userData,     setUserData]     = useState<UserData | null>(null)
  const [providerId,   setProviderId]   = useState<string | null>(null)
  const [providerBio,  setProviderBio]  = useState<string>('')
  const [verifStatus,  setVerifStatus]  = useState<VerifStatus>('none')
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState(false)
  const [uploadingPic, setUploadingPic] = useState(false)
  const [blockedUsers, setBlockedUsers] = useState<{ id: string; name: string; picUrl: string | null }[]>([])

  // ── Edit modal ─────────────────────────────────────────────────────────────

  const [editField,  setEditField]  = useState<EditField | null>(null)
  const [editValue,  setEditValue]  = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // ── Password modal ─────────────────────────────────────────────────────────

  const [showPwd,     setShowPwd]     = useState(false)
  const [currentPwd,  setCurrentPwd]  = useState('')
  const [newPwd,      setNewPwd]      = useState('')
  const [confirmPwd,  setConfirmPwd]  = useState('')
  const [pwdSaving,   setPwdSaving]   = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew,     setShowNew]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoadError(false)
    if (!userId) { setLoading(false); return }
    try {
      const { data: ud } = await supabase
        .from('users')
        .select('first_name, last_initial, role, profile_pic_url, is_verified, subscription_status, subscription_next_billing, subscription_waived')
        .eq('id', userId)
        .single()

      if (ud) {
        setUserData({
          ...(ud as any),
          email: session?.user?.email ?? '',
        } as UserData)

        // Load provider bio if this user has a provider role
        const role = (ud as any).role as UserRole
        if (role === 'provider' || role === 'both') {
          const { data: pd } = await supabase
            .from('providers')
            .select('id, bio')
            .eq('user_id', userId)
            .single()
          if (pd) {
            setProviderId((pd as any).id)
            setProviderBio((pd as any).bio ?? '')
          }
        }
      }

      // Verification status
      const isVerified = !!(ud as any)?.is_verified
      if (isVerified) {
        setVerifStatus('approved')
      } else {
        const { data: vr } = await supabase
          .from('verification_requests')
          .select('status')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (vr?.status === 'pending')  setVerifStatus('pending')
        else if (vr?.status === 'declined') setVerifStatus('declined')
        else setVerifStatus('none')
      }

      // Blocked users (people I've blocked) — resolve names/pics via public_profiles
      // (users RLS blocks reading other people's rows directly).
      const { data: blockRows } = await supabase
        .from('blocks')
        .select('blocked_id')
        .eq('blocker_id', userId)
      const blockedIds = [...new Set((blockRows ?? []).map((r: any) => r.blocked_id as string))]
      if (blockedIds.length > 0) {
        const { data: bu } = await supabase
          .from('public_profiles')
          .select('id, first_name, last_initial, profile_pic_url')
          .in('id', blockedIds)
        const map = Object.fromEntries((bu ?? []).map((u: any) => [u.id, u]))
        setBlockedUsers(blockedIds.map(id => {
          const u = map[id]
          const name = u
            ? (`${u.first_name ?? ''}${u.last_initial ? ` ${u.last_initial}.` : ''}`.trim() || 'User')
            : 'User'
          return { id, name, picUrl: u?.profile_pic_url ?? null }
        }))
      } else {
        setBlockedUsers([])
      }
    } catch (e) {
      console.error('settings load failed:', e)
      setLoadError(true)
    }
    setLoading(false)
  }, [userId, session])

  useEffect(() => { load() }, [load])

  // ── Profile picture ────────────────────────────────────────────────────────

  const changePic = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission needed', 'We need access to your photo library.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.85,
    })
    if (result.canceled || !result.assets[0]) return
    setUploadingPic(true)
    const { uri } = result.assets[0]
    try {
      const manipulated = await ImageManipulator.manipulateAsync(uri, [], { base64: true })
      const { data: up, error: uploadError } = await supabase.storage
        .from('profile-pics')
        .upload(`${userId}/profile.jpg`, decode(manipulated.base64!), {
          contentType: 'image/jpeg', upsert: true,
        })
      if (uploadError || !up) {
        console.error('changePic upload failed:', uploadError)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        Alert.alert('Couldn’t update photo', 'Please try again.')
        return
      }

      const { data: urlData } = supabase.storage.from('profile-pics').getPublicUrl(up.path)
      // Fixed-filename upload (<userId>/profile.jpg) → identical public URL every
      // time, so the image cache would serve the OLD pic. Stamp the stored URL with
      // a per-save cache-buster ONCE here; every read site renders it as-is.
      const newUrl = `${urlData.publicUrl}?t=${Date.now()}`

      // Write the new URL to BOTH the users row AND the providers row (keyed by
      // user_id). Public stylist surfaces read providers.profile_pic_url, so that
      // row must update too or the new pic never shows publicly. A non-provider
      // (model) simply matches 0 provider rows — that's not an error.
      const [
        { data: usersData, error: usersError },
        { data: providersData, error: providersError },
      ] = await Promise.all([
        supabase.from('users').update({ profile_pic_url: newUrl }).eq('id', userId).select(),
        supabase.from('providers').update({ profile_pic_url: newUrl }).eq('user_id', userId).select(),
      ])

      if (usersError || providersError) {
        console.error('changePic DB update failed:', { usersError, providersError, usersData, providersData })
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        Alert.alert('Couldn’t update photo', 'Please try again.')
        return
      }

      setUserData(p => p ? { ...p, profile_pic_url: newUrl } : p)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      console.error('changePic failed:', e)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Couldn’t update photo', 'Please try again.')
    } finally {
      setUploadingPic(false)
    }
  }

  // ── Edit field modal ───────────────────────────────────────────────────────

  const openEdit = async (field: EditField, current: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setEditField(field)
    setEditValue(current)
    setEditSaving(false)
  }

  const closeEdit = () => { setEditField(null); setEditValue(''); setEditSaving(false) }

  const saveEdit = async () => {
    if (!editField || !userId) return
    const val = editValue.trim()
    setEditSaving(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      // Only 'bio' is editable (email is read-only; name fields are fixed identity).
      if (providerId) await supabase.from('providers').update({ bio: val || null }).eq('id', providerId)
      setProviderBio(val)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      closeEdit()
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Error', err.message ?? 'Could not save changes.')
    }
    setEditSaving(false)
  }

  // ── Password ───────────────────────────────────────────────────────────────

  const closePwd = () => {
    setShowPwd(false)
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    setPwdSaving(false)
  }

  const savePassword = async () => {
    if (!newPwd || !currentPwd) { Alert.alert('Fill in all fields'); return }
    if (newPwd.length < 8) { Alert.alert('Too short', 'Password must be at least 8 characters.'); return }
    if (newPwd !== confirmPwd) { Alert.alert("Passwords don't match"); return }
    setPwdSaving(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: userData?.email ?? '', password: currentPwd,
      })
      if (signInErr) throw new Error('Current password is incorrect.')
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPwd })
      if (updateErr) throw updateErr
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      closePwd()
      Alert.alert('Password updated', 'Your new password is active.')
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Error', err.message ?? 'Could not update password.')
    }
    setPwdSaving(false)
  }


  // ── Subscription ───────────────────────────────────────────────────────────

  const cancelSubscription = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Alert.alert(
      'Cancel subscription?',
      'Your access continues until the end of your billing period, then reverts to Free.',
      [
        { text: 'Keep plan', style: 'cancel' },
        {
          text: 'Cancel subscription',
          style: 'destructive',
          onPress: async () => {
            // Real cancellation: the edge fn calls Stripe (cancel_at_period_end) and
            // updates the DB. Only reflect it locally if the call actually succeeds —
            // never flip to "cancelled" on a silent failure.
            const { data, error } = await supabase.functions.invoke('stripe-payment', {
              body: { action: 'cancel_subscription' },
            })
            if (error || (data as { success?: boolean } | null)?.success === false) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
              Alert.alert('Couldn\'t cancel', 'Please try again, or contact support if it keeps happening.')
              return
            }
            const cancelsAt = (data as { cancelsAt?: string } | null)?.cancelsAt ?? null
            setUserData(p => p ? { ...p, subscription_status: 'cancelling', subscription_next_billing: cancelsAt } : p)
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          },
        },
      ]
    )
  }

  const upgradeSubscription = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    Alert.alert('Upgrade to Premium', 'Premium features coming soon! You\'ll be notified when plans are available.')
  }

  // ── Verification ───────────────────────────────────────────────────────────

  const requestVerification = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    router.push('/(app)/verify-payment' as any)
  }

  // ── Role switching ─────────────────────────────────────────────────────────

  const switchRole = async (target: 'model' | 'provider') => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (target === 'provider') {
      router.replace('/provider-dashboard')
    } else {
      router.replace('/(app)' as any)
    }
  }

  // ── Danger zone ────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ])
  }

  const handleUnblock = async (blockedId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const { error } = await supabase.from('blocks')
      .delete()
      .eq('blocker_id', userId)
      .eq('blocked_id', blockedId)
    if (error) {
      Alert.alert('Couldn’t unblock', error.message ?? 'Please try again.')
      return
    }
    setBlockedUsers(prev => prev.filter(u => u.id !== blockedId))
    Alert.alert('Unblocked', 'You can interact with this user again.')
  }

  const handleDeleteAccount = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    Alert.alert(
      'Delete account',
      'This will permanently delete your account, profile, and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete my account',
          style: 'destructive',
          onPress: async () => {
            Alert.alert(
              'Are you absolutely sure?',
              'Your account and all associated data will be permanently removed. This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, delete everything',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      // Real deletion: the edge function removes the auth user, all
                      // DB rows and storage for the CALLER's own id (derived from JWT).
                      const { data, error } = await supabase.functions.invoke('delete-account')
                      if (error || (data as any)?.error) {
                        throw new Error((data as any)?.error ?? error?.message ?? 'delete failed')
                      }
                      await signOut()
                    } catch {
                      Alert.alert('Error', 'Could not delete account. Please try again or contact support@guineapigapp.co.uk.')
                    }
                  },
                },
              ]
            )
          },
        },
      ]
    )
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <LoadErrorState onRetry={() => load()} />
      </View>
    )
  }

  const dbRole     = userData?.role
  const isProvider = dbRole === 'provider' || dbRole === 'both'
  const isModel    = dbRole === 'model'    || dbRole === 'both'
  const isBoth     = dbRole === 'both'
  // Has an active-ish plan (grants access): active, trialling, or cancelling-at-period-end.
  // 'none'/'cancelled'/null = no plan → show Upgrade. (DB never uses 'free'.)
  const isComped    = !!userData?.subscription_waived
  const isPaid      = ['active', 'trialling', 'cancelling'].includes(userData?.subscription_status ?? '')
  const isCanceling = userData?.subscription_status === 'cancelling'
  const sub         = isComped
    ? { text: '✨ Complimentary', color: Colors.roseDark }
    : subscriptionLabel(userData?.subscription_status)

  const displayName = userData
    ? `${userData.first_name}${userData.last_initial ? ` ${userData.last_initial}.` : ''}`
    : ''

  const avatarSourceUri = userData?.profile_pic_url ?? null

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScreenDecor />
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Settings</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >

        {/* ─────────────── ACCOUNT ─────────────── */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          {/* Name is fixed identity (set once at signup) — read-only, no onPress. */}
          <Row
            icon="person-outline"
            label="First name"
            value={userData?.first_name}
          />
          <Row
            icon="at-outline"
            label="Last initial"
            value={userData?.last_initial ? `${userData.last_initial}.` : '—'}
          />
          {/* Email is read-only for now (change flow deferred pre-launch). */}
          <Row
            icon="mail-outline"
            label="Email"
            value={userData?.email}
          />
          <Row
            icon="lock-closed-outline"
            label="Password"
            value="••••••••"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowPwd(true) }}
            last
          />
        </View>

        {/* ─────────────── PROFILE ─────────────── */}
        <Text style={styles.sectionTitle}>Profile</Text>
        <View style={styles.card}>
          <Row
            icon="image-outline"
            label="Profile picture"
            onPress={changePic}
            rightEl={
              <View style={styles.picPreviewWrap}>
                {uploadingPic ? (
                  <ActivityIndicator size="small" color={Colors.roseDark} />
                ) : avatarSourceUri ? (
                  <Image source={{ uri: avatarSourceUri }} style={styles.picPreview} />
                ) : (
                  <View style={[styles.picPreview, styles.picPreviewPlaceholder]}>
                    <Ionicons name="person" size={14} color={Colors.muted} />
                  </View>
                )}
                <Ionicons name="chevron-forward" size={15} color={Colors.muted} style={{ marginLeft: 8 }} />
              </View>
            }
          />
          {isProvider && (
            <Row
              icon="document-text-outline"
              label="Bio"
              value={providerBio ? providerBio.slice(0, 36) + (providerBio.length > 36 ? '…' : '') : 'Not set'}
              onPress={() => openEdit('bio', providerBio)}
              last
            />
          )}
          {!isProvider && <View style={{ height: 1 }} />}
        </View>
        <Text style={styles.picCaption}>
          Use a clear photo of your face — it's compared to your verification selfie.
        </Text>

        {/* ─────────────── SUBSCRIPTION (models only) ─────────────── */}
        {isModel && (
          <>
            <Text style={styles.sectionTitle}>Subscription</Text>
            <View style={styles.card}>
              <Row
                icon="card-outline"
                label="Current plan"
                rightEl={
                  <Text style={[rowSt.value, { color: sub.color, fontWeight: '700' }]}>{sub.text}</Text>
                }
              />
              {isPaid && !isCanceling && userData?.subscription_next_billing && (
                <Row
                  icon="time-outline"
                  label="Next billing"
                  value={formatBillingDate(userData.subscription_next_billing)}
                />
              )}
              {isCanceling && (
                <Row
                  icon="time-outline"
                  label="Ends on"
                  value={formatBillingDate(userData?.subscription_next_billing)}
                />
              )}
              {!isPaid && !isComped && (
                <Row
                  icon="sparkles-outline"
                  label="Upgrade to Premium"
                  onPress={upgradeSubscription}
                  rightEl={
                    <View style={styles.upgradePill}>
                      <Text style={styles.upgradePillText}>Upgrade</Text>
                    </View>
                  }
                />
              )}
              {isPaid && !isCanceling && (
                <Row
                  icon="close-circle-outline"
                  label="Cancel subscription"
                  onPress={cancelSubscription}
                  danger
                  last
                />
              )}
              {(!isPaid || isCanceling) && <View style={{ height: 1 }} />}
            </View>
          </>
        )}

        {/* ─────────────── VERIFICATION ─────────────── */}
        <Text style={styles.sectionTitle}>Verification</Text>
        <View style={styles.card}>
          {verifStatus === 'approved' && (
            <Row
              icon="shield-checkmark-outline"
              label="Verified"
              rightEl={
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={Colors.rose} />
                  <Text style={styles.verifiedBadgeText}>Verified</Text>
                </View>
              }
              last
            />
          )}
          {verifStatus === 'pending' && (
            <Row
              icon="time-outline"
              label="Under review"
              rightEl={
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>In progress</Text>
                </View>
              }
              last
            />
          )}
          {verifStatus === 'declined' && (
            <>
              <Row
                icon="alert-circle-outline"
                label="Verification declined"
                rightEl={
                  <View style={styles.declinedBadge}>
                    <Text style={styles.declinedBadgeText}>Declined</Text>
                  </View>
                }
              />
              <Row
                icon="refresh-outline"
                label="Resubmit for review"
                onPress={requestVerification}
                last
              />
            </>
          )}
          {/* Providers start verification here (pay-first £14.99). Models do NOT —
             their identity check + £4.99/mo membership happen together at apply-time,
             so we show an expectation-setting line instead of a standalone selfie action. */}
          {verifStatus === 'none' && isProvider && (
            <Row
              icon="shield-outline"
              label="Get verified"
              onPress={requestVerification}
              rightEl={
                <View style={styles.getVerifiedBtn}>
                  <Text style={styles.getVerifiedBtnText}>Start</Text>
                  <Ionicons name="arrow-forward" size={12} color={Colors.roseDark} />
                </View>
              }
              last
            />
          )}
          {verifStatus === 'none' && isModel && !isProvider && (
            <Row
              icon="information-circle-outline"
              label="Verification and membership happen when you apply for a treatment"
              last
            />
          )}
        </View>

        {/* ─────────────── ROLE SWITCHER (both only) ─────────────── */}
        {isBoth && (
          <>
            <Text style={styles.sectionTitle}>Mode</Text>
            <View style={styles.card}>
              <Row
                icon="person-outline"
                label="Switch to Model view"
                onPress={() => switchRole('model')}
              />
              <Row
                icon="storefront-outline"
                label="Switch to Stylist view"
                onPress={() => switchRole('provider')}
                last
              />
            </View>
          </>
        )}

        {/* ─────────────── BLOCKED USERS ─────────────── */}
        <Text style={styles.sectionTitle}>Blocked users</Text>
        <View style={styles.card}>
          {blockedUsers.length === 0 ? (
            <Text style={styles.blockedEmpty}>You haven’t blocked anyone.</Text>
          ) : (
            blockedUsers.map((u, i) => (
              <View key={u.id} style={[rowSt.row, i < blockedUsers.length - 1 && rowSt.rowBorder]}>
                {u.picUrl ? (
                  <Image source={{ uri: u.picUrl }} style={styles.blockedAvatar} />
                ) : (
                  <View style={[styles.blockedAvatar, styles.blockedAvatarPlaceholder]}>
                    <Ionicons name="person" size={16} color={Colors.muted} />
                  </View>
                )}
                <Text style={rowSt.label} numberOfLines={1}>{u.name}</Text>
                <TouchableOpacity style={styles.unblockBtn} onPress={() => handleUnblock(u.id)} activeOpacity={0.8}>
                  <Text style={styles.unblockBtnText}>Unblock</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* ─────────────── LEGAL ─────────────── */}
        <Text style={styles.sectionTitle}>Legal</Text>
        <View style={styles.card}>
          {LEGAL_LINKS.map((l, i) => (
            <Row
              key={l.url}
              icon={l.icon}
              label={l.label}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                Linking.openURL(l.url)
              }}
              rightEl={<Ionicons name="open-outline" size={15} color={Colors.muted} />}
              last={i === LEGAL_LINKS.length - 1}
            />
          ))}
        </View>

        {/* ─────────────── DANGER ZONE ─────────────── */}
        <Text style={styles.sectionTitle}>Account actions</Text>
        <View style={styles.card}>
          <Row
            icon="log-out-outline"
            label="Sign out"
            onPress={handleSignOut}
            danger
          />
          <Row
            icon="trash-outline"
            label="Delete account"
            onPress={handleDeleteAccount}
            danger
            last
          />
        </View>

        {/* Version */}
        <Text style={styles.versionText}>Guinea Pig · v1.0.0</Text>
      </ScrollView>

      {/* ─────────────── EDIT FIELD MODAL ─────────────── */}
      <Modal
        visible={editField !== null}
        animationType="slide"
        transparent
        onRequestClose={closeEdit}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheetOuter}>
            <TouchableOpacity style={styles.sheetBackdrop} onPress={closeEdit} activeOpacity={1} />
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <View style={styles.sheetHandle} />
              <Text style={styles.modalTitle}>{editField ? editLabel(editField) : ''}</Text>
              <TextInput
                style={[styles.editInput, styles.editInputMultiline]}
                value={editValue}
                onChangeText={v => setEditValue(v.slice(0, editField ? editMaxLength(editField) : 400))}
                placeholder={editField ? editPlaceholder(editField) : ''}
                placeholderTextColor={Colors.muted}
                multiline
                autoCapitalize="words"
                autoFocus
                textAlignVertical="top"
              />
              {editField && (
                <Text style={styles.charCount}>
                  {editValue.length}/{editMaxLength(editField)}
                </Text>
              )}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={closeEdit}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, editSaving && { opacity: 0.6 }]}
                  onPress={saveEdit}
                  disabled={editSaving}
                  activeOpacity={0.9}
                >
                  {editSaving
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.saveBtnText}>Save</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─────────────── PASSWORD MODAL ─────────────── */}
      <Modal
        visible={showPwd}
        animationType="slide"
        transparent
        onRequestClose={closePwd}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheetOuter}>
            <TouchableOpacity style={styles.sheetBackdrop} onPress={closePwd} activeOpacity={1} />
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <View style={styles.sheetHandle} />
              <Text style={styles.modalTitle}>Change password</Text>

              {/* Current */}
              <Text style={styles.pwdLabel}>Current password</Text>
              <View style={styles.pwdInputWrap}>
                <TextInput
                  style={styles.pwdInput}
                  value={currentPwd}
                  onChangeText={setCurrentPwd}
                  secureTextEntry={!showCurrent}
                  placeholder="Enter current password"
                  placeholderTextColor={Colors.muted}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowCurrent(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name={showCurrent ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.muted} />
                </TouchableOpacity>
              </View>

              {/* New */}
              <Text style={[styles.pwdLabel, { marginTop: 12 }]}>New password</Text>
              <View style={styles.pwdInputWrap}>
                <TextInput
                  style={styles.pwdInput}
                  value={newPwd}
                  onChangeText={setNewPwd}
                  secureTextEntry={!showNew}
                  placeholder="At least 8 characters"
                  placeholderTextColor={Colors.muted}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowNew(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.muted} />
                </TouchableOpacity>
              </View>

              {/* Confirm */}
              <Text style={[styles.pwdLabel, { marginTop: 12 }]}>Confirm new password</Text>
              <View style={styles.pwdInputWrap}>
                <TextInput
                  style={styles.pwdInput}
                  value={confirmPwd}
                  onChangeText={setConfirmPwd}
                  secureTextEntry={!showConfirm}
                  placeholder="Repeat new password"
                  placeholderTextColor={Colors.muted}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowConfirm(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.muted} />
                </TouchableOpacity>
              </View>

              {confirmPwd.length > 0 && newPwd !== confirmPwd && (
                <Text style={styles.pwdError}>Passwords don't match</Text>
              )}

              <View style={[styles.modalActions, { marginTop: 20 }]}>
                <TouchableOpacity style={styles.cancelBtn} onPress={closePwd} activeOpacity={0.8}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, pwdSaving && { opacity: 0.6 }]}
                  onPress={savePassword}
                  disabled={pwdSaving}
                  activeOpacity={0.9}
                >
                  {pwdSaving
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.saveBtnText}>Update</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },
  centred:   { alignItems: 'center', justifyContent: 'center' },

  // Blocked users
  blockedEmpty: {
    fontSize: 14, color: Colors.muted, paddingHorizontal: 16, paddingVertical: 16,
  },
  blockedAvatar: { width: 32, height: 32, borderRadius: 16 },
  blockedAvatarPlaceholder: {
    backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center',
  },
  unblockBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  unblockBtnText: { fontSize: 13, fontWeight: '700', color: Colors.roseDark },

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
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  topBarTitle: {
    fontFamily: Fonts.display,
    flex: 1, textAlign: 'center', fontSize: 22,
    color: Colors.rose, letterSpacing: -0.3,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 8, marginTop: 24, paddingHorizontal: 4,
  },
  subSectionTitle: {
    fontSize: 11, fontWeight: '700', color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 8, marginTop: 16, paddingHorizontal: 4,
  },
  picCaption: {
    fontSize: 12, color: Colors.muted, lineHeight: 17,
    marginTop: 8, paddingHorizontal: 6,
  },

  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadow.soft,
  },

  // Profile pic preview
  picPreviewWrap:   { flexDirection: 'row', alignItems: 'center' },
  picPreview:       { width: 32, height: 32, borderRadius: 8 },
  picPreviewPlaceholder: {
    backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center',
  },

  // Subscription
  upgradePill: {
    backgroundColor: Colors.rose, borderRadius: Radius.sm,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  upgradePillText: { fontSize: 12, fontWeight: '700', color: Colors.white },

  // Verification badges
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.softPink, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  verifiedBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.roseDark },
  pendingBadge: {
    backgroundColor: Colors.inputBg, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  pendingBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.roseDark },
  declinedBadge: {
    backgroundColor: Colors.inputBg, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  declinedBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.error },
  getVerifiedBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.softPink + '50', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  getVerifiedBtnText: { fontSize: 12, fontWeight: '700', color: Colors.roseDark },

  // Role
  activePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.softPink + '40', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  activePillText: { fontSize: 12, fontWeight: '700', color: Colors.roseDark },

  // Version
  versionText: {
    textAlign: 'center', fontSize: 12, color: Colors.border,
    marginTop: 24, fontWeight: '500',
  },

  // Bottom sheet (shared)
  sheetOuter:   { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: Colors.cream, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingHorizontal: 16, paddingTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 16,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18, color: Colors.warmDark,
    marginBottom: 14, paddingHorizontal: 2,
  },

  // Edit field
  editInput: {
    backgroundColor: Colors.inputBg, borderRadius: 14, borderWidth: 1.5,
    borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 13,
    fontSize: 15, color: Colors.warmDark,
  },
  editInputMultiline: { minHeight: 100, textAlignVertical: 'top', paddingTop: 13 },
  charCount:  { fontSize: 11, color: Colors.muted, textAlign: 'right', marginTop: 4 },
  editHint:   { fontSize: 12, color: Colors.muted, marginTop: 8, lineHeight: 17 },

  // Modal actions
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white,
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },
  saveBtn: {
    flex: 2, height: 50, borderRadius: Radius.md, backgroundColor: Colors.rose,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },
  saveBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.white },

  // Password modal
  pwdLabel: { fontSize: 13, fontWeight: '600', color: Colors.warmDark, marginBottom: 6, marginTop: 4 },
  pwdInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.inputBg, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 16, height: 50,
  },
  pwdInput: { flex: 1, fontSize: 15, color: Colors.warmDark },
  pwdError: { fontSize: 12, color: Colors.error, marginTop: 6, fontWeight: '500' },
})
