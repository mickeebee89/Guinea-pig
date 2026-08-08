import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { supabase } from '@/lib/supabase'

/**
 * The consent gate, rendered FROM the active consent document.
 *
 * It used to hardcode its items and persist nothing. Two problems came out of
 * that: there was no record anyone had consented, and the hardcoded copy had
 * silently diverged from consent_documents — an active v1 carrying the risk
 * disclosure (providers are learners, may not be qualified) had existed since
 * June and was never shown to anyone.
 *
 * Rendering from the document is what stops that recurring. The id, version and
 * content_hash handed to onAccept are the ones from the document THIS SCREEN
 * RENDERED — never looked up again at write time. If a new version goes active
 * while someone is reading, the record still says what they actually agreed to.
 *
 * FAILS CLOSED. No active document, a failed fetch, or a document with no
 * tickable items all block the booking. There is deliberately no hardcoded
 * fallback: falling back to local copy is exactly the divergence being removed,
 * and it would mean recording consent to a document the user never saw.
 */

export interface ConsentAck {
  key: string
  requires_tick: boolean
  text?: string
  icon?: string
  title?: string
  body?: string
}

export interface AcceptedConsent {
  consent_document_id: string
  consent_version: number
  content_hash: string
  /** One entry per item, ticked ones marked — the whole document, as agreed. */
  acknowledgements: { key: string; text: string; agreed: boolean }[]
}

type Props = { onAccept: (consent: AcceptedConsent) => void }

interface ConsentDoc {
  id: string
  version: number
  title: string
  body: string
  content_hash: string
  acknowledgements: ConsentAck[]
}

export function ConsentGate({ onAccept }: Props) {
  const [doc, setDoc] = useState<ConsentDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Record<string, boolean>>({})

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('consent_documents')
      .select('id, version, title, body, content_hash, acknowledgements')
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      setLoadError('We couldn’t load the consent terms. Please check your connection and try again.')
    } else if (!data) {
      // Not a network problem — nothing is marked active. Blocking is correct:
      // a booking with no consent record is the hole this whole flow closes.
      setLoadError('Consent terms are unavailable right now, so applications are paused. Please try again shortly.')
    } else if (!(data.acknowledgements ?? []).some((a: ConsentAck) => a.requires_tick)) {
      setLoadError('Consent terms are incomplete, so applications are paused. Please try again shortly.')
    } else {
      setDoc(data as ConsentDoc)
      setTicked({})   // never pre-ticked
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const ticks   = (doc?.acknowledgements ?? []).filter(a => a.requires_tick)
  const notices = (doc?.acknowledgements ?? []).filter(a => !a.requires_tick)
  const allTicked = ticks.length > 0 && ticks.every(a => ticked[a.key])

  const toggle = async (key: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setTicked(t => ({ ...t, [key]: !t[key] }))
  }

  const handleContinue = async () => {
    if (!doc || !allTicked) return
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onAccept({
      consent_document_id: doc.id,
      consent_version:     doc.version,
      content_hash:        doc.content_hash,
      // Record every item, not just the ticked ones, so the row shows the whole
      // document as presented rather than a filtered view of it.
      acknowledgements: doc.acknowledgements.map(a => ({
        key:    a.key,
        text:   a.text ?? a.title ?? a.key,
        agreed: a.requires_tick ? !!ticked[a.key] : true,
      })),
    })
  }

  if (loading) {
    return (
      <View style={styles.stateBox}>
        <ActivityIndicator color={Colors.rose} />
        <Text style={styles.stateText}>Loading the terms…</Text>
      </View>
    )
  }

  if (loadError || !doc) {
    return (
      <View style={styles.stateBox}>
        <View style={styles.iconCircle}>
          <Ionicons name="alert-circle-outline" size={30} color={Colors.roseDark} />
        </View>
        <Text style={styles.stateTitle}>Can’t continue just yet</Text>
        <Text style={styles.stateText}>{loadError}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.9}>
          <Ionicons name="refresh" size={16} color={Colors.white} />
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconRow}>
        <View style={styles.iconCircle}>
          <Ionicons name="shield-checkmark-outline" size={32} color={Colors.roseDark} />
        </View>
      </View>

      <Text style={styles.title}>{doc.title}</Text>
      <Text style={styles.subtitle}>{doc.body}</Text>

      {notices.map(item => (
        <View key={item.key} style={styles.termCard}>
          <View style={styles.termIcon}>
            <Ionicons name={(item.icon ?? 'information-circle-outline') as never} size={20} color={Colors.roseDark} />
          </View>
          <View style={styles.termText}>
            <Text style={styles.termTitle}>{item.title}</Text>
            <Text style={styles.termBody}>{item.body}</Text>
          </View>
        </View>
      ))}

      {/* One tick per item — never a single blanket checkbox, and never
          pre-ticked. Each is recorded individually. */}
      <Text style={styles.ackHeading}>Please confirm each of these</Text>
      {ticks.map(item => {
        const on = !!ticked[item.key]
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.checkRow, on && styles.checkRowOn]}
            onPress={() => toggle(item.key)}
            activeOpacity={0.8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={item.text}
          >
            <View style={[styles.checkbox, on && styles.checkboxActive]}>
              {on && <Ionicons name="checkmark" size={14} color={Colors.white} />}
            </View>
            <Text style={styles.checkLabel}>{item.text}</Text>
          </TouchableOpacity>
        )
      })}

      <TouchableOpacity
        style={[styles.continueBtn, !allTicked && styles.continueBtnDisabled]}
        disabled={!allTicked}
        onPress={handleContinue}
        activeOpacity={0.9}
      >
        <Text style={styles.continueBtnText}>Continue to confirmation</Text>
        <Ionicons name="arrow-forward" size={18} color={Colors.white} />
      </TouchableOpacity>

      {!allTicked && (
        <Text style={styles.hint}>
          {ticks.filter(a => !ticked[a.key]).length} left to confirm
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { paddingBottom: 8 },

  stateBox: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 16,
    gap: 10,
  },
  stateTitle: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.warmDark,
    marginTop: 4,
  },
  stateText: {
    fontSize: 14,
    color: Colors.muted,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.rose,
    borderRadius: Radius.pill,
    paddingHorizontal: 20,
    height: 44,
    marginTop: 8,
  },
  retryBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.white,
  },

  iconRow: { alignItems: 'center', marginBottom: 16 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.softPink + '50',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.softPink,
  },

  title: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.rose,
    letterSpacing: -0.4,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.muted,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },

  termCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.soft,
  },
  termIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.softPink + '40',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  termText: { flex: 1 },
  termTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.warmDark,
    marginBottom: 3,
  },
  termBody: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
  },

  ackHeading: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: Colors.warmDark,
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 4,
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  checkRowOn: {
    borderColor: Colors.rose,
    backgroundColor: Colors.inputBg,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkboxActive: {
    backgroundColor: Colors.rose,
    borderColor: Colors.rose,
  },
  checkLabel: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.warmDark,
    lineHeight: 20,
  },

  continueBtn: {
    backgroundColor: Colors.rose,
    borderRadius: Radius.lg,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 8,
    ...Shadow.card,
  },
  continueBtnDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
    elevation: 0,
  },
  continueBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.white,
    letterSpacing: -0.2,
  },
  hint: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    marginBottom: 8,
  },
})
