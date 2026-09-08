import { useState, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius, Spacing } from '@/constants/Colors'
import { supabase } from '@/lib/supabase'
import { mustWrite } from '@/lib/db'

const MAX = 280

/**
 * "What's on" — a stylist's 48-hour update, on the phone.
 *
 * ── WHY THIS EXISTS AT ALL (audit item 21) ────────────────────────────────
 * status_posts shipped with exactly one writer: the web dashboard composer.
 * Mobile could READ a status — the bar on a stylist's profile — and could not
 * write one, so a stylist who only ever opens the app on their phone, which is
 * the primary client, could not post. A read surface with no writer.
 *
 * ── NOTHING HERE ENFORCES ANYTHING ────────────────────────────────────────
 * No screening, no link stripping, no moderation decision. All three are
 * triggers on status_posts (migration 0032), and a check in this file would be
 * bypassed by calling PostgREST directly with the stylist's own token — the
 * session the app already handed them.
 *
 * -- APPROVED IS NOT LIVE (7 Sep 2026) ------------------------------------
 * Both composers rendered "Live now" off moderation_status === 'approved'.
 * Approved is a moderation state; visible is something else. Three things hide
 * an approved post -- an unpublished shop, expiry, and a block -- and neither
 * composer knew about any of them, so a stylist whose shop was not published
 * was told the thing they wanted had happened.
 *
 * isLive is READ from public_stylist_status (0033), which is the definition of
 * publicly visible, rather than recomputed here. A second copy of that rule
 * diverges the first time the view changes, and the view already carries a
 * clause -- the seed-account guard -- that nobody writing this file would have
 * thought to include. A block is the one thing the view cannot express, being
 * per-viewer rather than a property of the post.
 *
 * So this is a plain insert, and it reads back WHAT THE DATABASE DECIDED rather
 * than assuming publication. A composer that clears and says "posted!" while
 * the row sits pending is the exact failure the moderation queue exists to
 * remove. Kept deliberately in step with site/app/(app)/dashboard/StatusComposer.tsx.
 */
type Post = {
  id: string
  body: string
  expires_at: string
  moderation_status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
}

export default function StatusComposer({
  providerId, shopIsPublished,
}: {
  providerId: string
  /** Used only to WORD the explanation, never to decide visibility -- the view
   *  does that. Kept separate so the two cannot drift into one rule expressed
   *  twice. */
  shopIsPublished: boolean
}) {
  const [current, setCurrent] = useState<Post | null>(null)
  const [isLive, setIsLive]   = useState(false)
  const [body, setBody]       = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    // The author's own post whatever its moderation state — 0031's read policy
    // lets a stylist see their own held and rejected posts, and this screen is
    // the only place that can explain why one never appeared.
    const { data, error: err } = await supabase
      .from('status_posts')
      .select('id, body, expires_at, moderation_status, review_note')
      .eq('provider_id', providerId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (err) { setLoading(false); setError("Couldn't load your update."); return }
    setError(null)
    const post = (data as Post | null) ?? null
    setCurrent(post)

    // ASK THE VIEW. One lookup by primary key, only when there is an approved
    // post to ask about. Fails closed: if the check errors we do not claim the
    // post is live, because a false "live" is the bug this removes.
    if (post && post.moderation_status === 'approved') {
      const { data: liveRow, error: liveErr } = await supabase
        .from('public_stylist_status').select('id').eq('id', post.id).maybeSingle()
      if (liveErr) console.error('[status] visibility check failed', liveErr.message)
      setIsLive(!liveErr && !!liveRow)
    } else {
      setIsLive(false)
    }
    setLoading(false)
  }, [providerId])

  // Reloads on focus: a decision made in the admin queue while the app sat in
  // the background is the whole reason to look again.
  useFocusEffect(useCallback(() => { load() }, [load]))

  const post = async () => {
    const text = body.trim()
    if (!text) return
    setBusy(true); setError(null)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    try {
      // One live post at a time — posting again replaces the last one. A second,
      // older update still showing would be worse than none. RLS confines the
      // delete to this stylist's own rows.
      await mustWrite(
        supabase.from('status_posts').delete()
          .eq('provider_id', providerId)
          .gt('expires_at', new Date().toISOString()),
        'clear previous status post',
      )
      await mustWrite(
        supabase.from('status_posts').insert({ provider_id: providerId, body: text }),
        'insert status post',
      )
      setBody('')
      await load()
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError(e instanceof Error ? e.message : 'That didn’t save. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true); setError(null)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      await mustWrite(
        supabase.from('status_posts').delete()
          .eq('provider_id', providerId)
          .gt('expires_at', new Date().toISOString()),
        'clear status post',
      )
      await load()
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError('That didn’t clear. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={s.card}>
      {loading ? (
        <ActivityIndicator color={Colors.roseDark} style={{ marginVertical: Spacing.md }} />
      ) : (
        <>
          {current && (
            <View style={s.currentBox}>
              {/* Rendered as text. Links were stripped at write time by trigger,
                  and nothing here parses the body. */}
              <Text style={s.currentBody}>{current.body}</Text>

              {current.moderation_status === 'approved' && isLive && (
                <Text style={s.live}>Live now · disappears automatically after 48 hours</Text>
              )}

              {/* Approved, and the view still does not carry it. Saved, not
                  rejected, and worth saying in that order. */}
              {current.moderation_status === 'approved' && !isLive && (
                <Text style={s.pending}>
                  {shopIsPublished
                    ? 'Posted, but it isn\u2019t showing to models yet. It\u2019s saved \u2014 nothing is wrong with what you wrote.'
                    : 'Posted \u2014 it\u2019ll go out once your shop is live. Turn your shop on in Your shop, above, and models will start seeing it.'}
                </Text>
              )}

              {/* HELD, not lost. */}
              {current.moderation_status === 'pending' && (
                <Text style={s.pending}>
                  Waiting on a quick review before it goes out. It isn’t visible to anyone
                  yet — we’ll let you know either way.
                </Text>
              )}

              {current.moderation_status === 'rejected' && (
                <>
                  <Text style={s.rejected}>This one wasn’t published.</Text>
                  {/* The admin's note, when they left one. It deliberately never
                      names the term that tripped the screen. */}
                  {!!current.review_note && <Text style={s.note}>{current.review_note}</Text>}
                  <Text style={s.note}>You can write a different one below.</Text>
                </>
              )}

              <TouchableOpacity onPress={clear} disabled={busy} style={s.clearBtn}>
                <Text style={s.clearText}>
                  {current.moderation_status === 'approved' && isLive ? 'Take it down' : 'Clear it'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={s.hint}>
            Models near you see this for 48 hours. Links are removed automatically.
          </Text>

          <TextInput
            value={body}
            onChangeText={t => setBody(t.slice(0, MAX))}
            placeholder="Two spaces free Thursday afternoon"
            placeholderTextColor={Colors.muted}
            multiline
            editable={!busy}
            style={s.input}
          />

          <View style={s.actions}>
            <TouchableOpacity
              onPress={post}
              disabled={busy || !body.trim()}
              style={[s.postBtn, (busy || !body.trim()) && s.postBtnOff]}
            >
              {busy
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={s.postText}>{current ? 'Post a new one' : 'Post update'}</Text>}
            </TouchableOpacity>
            <Text style={s.count}>{body.length}/{MAX}</Text>
          </View>

          {!!error && <Text style={s.error}>{error}</Text>}
        </>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginTop: Spacing.md,
  },
  currentBox: {
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  currentBody: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.warmDark },
  live:     { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.rose,    marginTop: 6 },
  pending:  { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.muted,   marginTop: 6 },
  rejected: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.error,   marginTop: 6 },
  note:     { fontFamily: Fonts.body,     fontSize: 12, color: Colors.muted,   marginTop: 4 },
  clearBtn: { minHeight: 44, justifyContent: 'center' },
  clearText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.muted },

  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted, marginBottom: 6 },
  input: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.inputBg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.warmDark,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.md },
  postBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.pill,
    backgroundColor: Colors.rose,
  },
  postBtnOff: { opacity: 0.5 },
  postText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.white },
  count: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted },
  error: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.error, marginTop: Spacing.sm },
})
