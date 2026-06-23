import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/Colors'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type Review = {
  id: string
  rating: number
  comment: string | null
  tags: string[]
  created_at: string
  reviewer_id: string
  reviewer_name: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StarRating({ rating, size = 13 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={i <= Math.round(rating) ? 'star' : 'star-outline'}
          size={size}
          color="#F59E0B"
        />
      ))}
    </View>
  )
}

function ReviewCard({ review }: { review: Review }) {
  const name = review.reviewer_name
  const initials = name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarInitials}>{initials}</Text>
        </View>
        <View style={styles.reviewerMeta}>
          <Text style={styles.reviewerName}>{name}</Text>
          <View style={styles.ratingRow}>
            <StarRating rating={review.rating} />
            <Text style={styles.dateText}> · {formatDate(review.created_at)}</Text>
          </View>
        </View>
      </View>
      {review.tags.length > 0 && (
        <View style={styles.tagsRow}>
          {review.tags.map(tag => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
      {review.comment ? (
        <Text style={styles.comment}>{review.comment}</Text>
      ) : null}
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ReviewsScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>()
  const insets = useSafeAreaInsets()

  const [reviews,  setReviews]  = useState<Review[]>([])
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return }
    try {
      const { data: revData, error: revErr } = await supabase
        .from('reviews')
        .select('id, rating:overall_rating, comment, tags, created_at, reviewer_id')
        .eq('reviewee_id', userId)
        .order('created_at', { ascending: false })

      if (revErr) { console.error('reviews fetch failed:', revErr); setLoading(false); return }

      if (revData && (revData as any[]).length > 0) {
        const reviewerIds = [...new Set((revData as any[]).map((r: any) => r.reviewer_id))]
        const { data: userRows, error: userErr } = await supabase
          .from('users')
          .select('id, first_name, last_initial')
          .in('id', reviewerIds)
        if (userErr) console.warn('reviews name lookup failed:', userErr)

        const userMap: Record<string, string> = {}
        ;(userRows as any[] ?? []).forEach((u: any) => {
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
    } catch (e) { console.error('reviews screen load failed:', e) }
    setLoading(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  const avg = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Reviews', headerBackTitle: 'Back' }} />
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        {loading ? (
          <View style={styles.centred}>
            <ActivityIndicator color={Colors.roseDark} />
          </View>
        ) : (
          <FlatList
            data={reviews}
            keyExtractor={r => r.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              avg !== null ? (
                <View style={styles.summaryHeader}>
                  <Ionicons name="star" size={20} color="#F59E0B" />
                  <Text style={styles.avgText}>{avg}</Text>
                  <Text style={styles.countText}>({reviews.length} review{reviews.length !== 1 ? 's' : ''})</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <Text style={styles.empty}>No reviews yet.</Text>
            }
            renderItem={({ item }) => <ReviewCard review={item} />}
          />
        )}
      </View>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centred:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:      { padding: 16, paddingTop: 8 },

  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  avgText:   { fontSize: 22, fontWeight: '800', color: Colors.warmDark },
  countText: { fontSize: 14, color: Colors.muted },

  empty: { textAlign: 'center', color: Colors.muted, fontSize: 15, paddingTop: 40 },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader:      { flexDirection: 'row', gap: 10, marginBottom: 8 },
  avatarPlaceholder: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.softPink,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials:  { fontSize: 13, fontWeight: '700', color: Colors.roseDark },
  reviewerMeta:    { gap: 3 },
  reviewerName:    { fontSize: 14, fontWeight: '600', color: Colors.warmDark },
  ratingRow:       { flexDirection: 'row', alignItems: 'center' },
  dateText:        { fontSize: 11, color: Colors.muted },
  tagsRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag:             { backgroundColor: Colors.inputBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  tagText:         { fontSize: 11, fontWeight: '600', color: Colors.muted },
  comment:         { fontSize: 14, color: Colors.warmDark, lineHeight: 20, opacity: 0.85 },
})
