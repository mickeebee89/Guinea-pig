import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = {
  id: string
  name: string
  sort_order: number
}

type PortfolioItem = {
  id: string
  media_url: string
  media_type: 'photo' | 'video'
  category_id: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByCategory(items: PortfolioItem[], categories: Category[]): { label: string; catId: string | null; items: PortfolioItem[] }[] {
  const groups: { label: string; catId: string | null; items: PortfolioItem[] }[] = []

  // Named categories in sort order
  for (const cat of categories) {
    const catItems = items.filter(i => i.category_id === cat.id)
    if (catItems.length > 0) {
      groups.push({ label: cat.name, catId: cat.id, items: catItems })
    }
  }

  // Uncategorised
  const uncatItems = items.filter(i => !i.category_id)
  if (uncatItems.length > 0) {
    groups.push({ label: 'Uncategorised', catId: null, items: uncatItems })
  }

  return groups
}

// ── Screen ────────────────────────────────────────────────────────────────────

const ITEM_SIZE = 106

export default function PortfolioScreen() {
  const router  = useRouter()
  const { session } = useAuth()
  const userId  = session?.user?.id

  const [providerId,   setProviderId]   = useState<string | null>(null)
  const [categories,   setCategories]   = useState<Category[]>([])
  const [items,        setItems]        = useState<PortfolioItem[]>([])
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [uploading,    setUploading]    = useState(false)

  // Create category modal
  const [showNewCatModal,   setShowNewCatModal]   = useState(false)
  const [newCatName,        setNewCatName]        = useState('')
  const [savingCat,         setSavingCat]         = useState(false)

  // Category picker (shown after image is picked)
  const [showCatPicker,     setShowCatPicker]     = useState(false)
  const [pendingAsset,      setPendingAsset]      = useState<ImagePicker.ImagePickerAsset | null>(null)
  const [pickedCatId,       setPickedCatId]       = useState<string | null>(null)
  const [pickedCatName,     setPickedCatName]     = useState<string | null>(null)

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async (isRefresh = false) => {
    if (!userId) return
    if (!isRefresh) setLoading(true)
    try {
      const { data: prov } = await supabase
        .from('providers')
        .select('id')
        .eq('user_id', userId)
        .single()

      if (prov) {
        const pid = (prov as any).id as string
        setProviderId(pid)

        const [{ data: catData }, { data: itemData }] = await Promise.all([
          supabase
            .from('portfolio_categories')
            .select('id, name, sort_order')
            .eq('provider_id', pid)
            .order('sort_order'),
          supabase
            .from('portfolio_items')
            .select('id, media_url, media_type, category_id')
            .eq('provider_id', pid)
            .order('created_at', { ascending: false }),
        ])

        setCategories((catData ?? []) as Category[])
        setItems((itemData ?? []) as PortfolioItem[])
      }
    } catch {}
    setLoading(false)
    setRefreshing(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  const onRefresh = () => { setRefreshing(true); load(true) }

  // ── Create category ────────────────────────────────────────────────────────

  const handleCreateCategory = async () => {
    const name = newCatName.trim()
    if (!name || !providerId) return
    setSavingCat(true)
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      const { data: inserted, error } = await supabase
        .from('portfolio_categories')
        .insert({ provider_id: providerId, name, sort_order: categories.length })
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

  // ── Add photo flow ─────────────────────────────────────────────────────────

  const handleAddPhoto = async () => {
    if (!providerId || !userId) return

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    })

    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]

    if (categories.length > 0) {
      // Let user pick a category before uploading
      setPendingAsset(asset)
      setPickedCatId(null)
      setPickedCatName(null)
      setShowCatPicker(true)
    } else {
      // No categories yet — upload directly
      await uploadPhoto(asset, null, null)
    }
  }

  const confirmUpload = async () => {
    if (!pendingAsset) return
    setShowCatPicker(false)
    await uploadPhoto(pendingAsset, pickedCatId, pickedCatName)
    setPendingAsset(null)
  }

  const uploadPhoto = async (
    asset: ImagePicker.ImagePickerAsset,
    catId: string | null,
    catName: string | null,
  ) => {
    if (!providerId || !userId) return
    setUploading(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1080, height: 1080 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      )
      if (!manipulated.base64) throw new Error('Image processing failed')

      const fileName = `${userId}/${Date.now()}-portfolio.jpg`
      const { decode } = await import('base64-arraybuffer')

      const { data: up, error: uploadErr } = await supabase.storage
        .from('portfolio-photos')
        .upload(fileName, decode(manipulated.base64), { contentType: 'image/jpeg' })

      if (uploadErr) throw uploadErr

      const { data: urlData } = supabase.storage
        .from('portfolio-photos')
        .getPublicUrl(up.path)

      const { data: inserted, error: insertErr } = await supabase
        .from('portfolio_items')
        .insert({
          provider_id: providerId,
          media_url:   urlData.publicUrl,
          media_type:  'photo',
          category_id: catId,
        })
        .select('id, media_url, media_type, category_id')
        .single()

      if (insertErr) throw insertErr

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setItems(prev => [inserted as PortfolioItem, ...prev])
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Upload failed', e?.message ?? 'Could not upload photo. Please try again.')
    }
    setUploading(false)
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = (item: PortfolioItem) => {
    Alert.alert('Delete photo?', 'This will permanently remove this photo from your portfolio.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          try {
            await supabase.from('portfolio_items').delete().eq('id', item.id)
            setItems(prev => prev.filter(p => p.id !== item.id))
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          } catch {
            Alert.alert('Error', 'Could not delete photo. Please try again.')
          }
        },
      },
    ])
  }

  // ── Delete category ────────────────────────────────────────────────────────

  const handleDeleteCategory = (cat: Category) => {
    const count = items.filter(i => i.category_id === cat.id).length
    Alert.alert(
      `Delete "${cat.name}"?`,
      count > 0
        ? `This will remove the category but keep the ${count} photo${count > 1 ? 's' : ''} as uncategorised.`
        : 'This category has no photos.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            try {
              await supabase.from('portfolio_categories').delete().eq('id', cat.id)
              setCategories(prev => prev.filter(c => c.id !== cat.id))
              // Unset category_id on affected items locally
              setItems(prev => prev.map(i =>
                i.category_id === cat.id ? { ...i, category_id: null, category_name: null } : i
              ))
            } catch {
              Alert.alert('Error', 'Could not delete category.')
            }
          },
        },
      ]
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const groups = groupByCategory(items, categories)
  const hasContent = items.length > 0

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={22} color={Colors.warmDark} />
          </TouchableOpacity>
          <Text style={styles.title}>Portfolio</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => { setNewCatName(''); setShowNewCatModal(true) }}
              activeOpacity={0.8}
            >
              <Ionicons name="folder-outline" size={18} color={Colors.rose} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addBtn, uploading && { opacity: 0.5 }]}
              onPress={handleAddPhoto}
              disabled={uploading}
              activeOpacity={0.8}
            >
              {uploading
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Ionicons name="add" size={22} color={Colors.white} />
              }
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={styles.centred}>
            <ActivityIndicator color={Colors.rose} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rose} colors={[Colors.rose]} />
            }
          >
            {!hasContent ? (
              <View style={styles.emptyState}>
                <Ionicons name="images-outline" size={56} color={Colors.muted} />
                <Text style={styles.emptyTitle}>No portfolio photos yet</Text>
                <Text style={styles.emptyText}>
                  Tap + to add your first photo and show models what you can do
                </Text>
                <View style={styles.emptyActions}>
                  <TouchableOpacity
                    style={styles.emptySecondaryBtn}
                    onPress={() => { setNewCatName(''); setShowNewCatModal(true) }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="folder-outline" size={16} color={Colors.rose} />
                    <Text style={styles.emptySecondaryBtnText}>Create a category</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addFirstBtn, uploading && { opacity: 0.5 }]}
                    onPress={handleAddPhoto}
                    disabled={uploading}
                    activeOpacity={0.85}
                  >
                    {uploading
                      ? <ActivityIndicator color={Colors.white} />
                      : <Text style={styles.addFirstBtnText}>Add a photo</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            ) : groups.length > 0 ? (
              <>
                {groups.map(group => (
                  <View key={group.catId ?? '__uncat__'} style={styles.catSection}>
                    <View style={styles.catHeader}>
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
                    <View style={styles.grid}>
                      {group.items.map(item => (
                        <PhotoCard key={item.id} item={item} onDelete={handleDelete} />
                      ))}
                    </View>
                  </View>
                ))}
                <Text style={styles.hint}>Long-press a photo to delete it</Text>
              </>
            ) : (
              // Items exist but no grouping (all uncategorised)
              <View>
                <View style={styles.grid}>
                  {items.map(item => (
                    <PhotoCard key={item.id} item={item} onDelete={handleDelete} />
                  ))}
                </View>
                <Text style={styles.hint}>Long-press a photo to delete it</Text>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      {/* ── Create category modal ── */}
      <Modal
        visible={showNewCatModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowNewCatModal(false)}
      >
        <View style={styles.modalOuter}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            onPress={() => setShowNewCatModal(false)}
            activeOpacity={1}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Create category</Text>
            <Text style={styles.modalSub}>Group your photos under a heading, e.g. "Nail Art" or "Lash Sets"</Text>
            <TextInput
              style={styles.catInput}
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
              style={[styles.modalBtn, (!newCatName.trim() || savingCat) && styles.modalBtnDisabled]}
              onPress={handleCreateCategory}
              disabled={!newCatName.trim() || savingCat}
              activeOpacity={0.9}
            >
              {savingCat ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.modalBtnText}>Create</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setShowNewCatModal(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Category picker (before upload) ── */}
      <Modal
        visible={showCatPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCatPicker(false)}
      >
        <View style={styles.modalOuter}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            onPress={() => setShowCatPicker(false)}
            activeOpacity={1}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Add to category</Text>
            <Text style={styles.modalSub}>Optional — choose where this photo belongs</Text>

            <ScrollView style={styles.catPickerList} showsVerticalScrollIndicator={false}>
              {/* No category option */}
              <TouchableOpacity
                style={[styles.catPickerItem, pickedCatId === null && styles.catPickerItemSelected]}
                onPress={() => { setPickedCatId(null); setPickedCatName(null) }}
                activeOpacity={0.8}
              >
                <Text style={[styles.catPickerItemText, pickedCatId === null && styles.catPickerItemTextSelected]}>
                  No category
                </Text>
                {pickedCatId === null && (
                  <Ionicons name="checkmark-circle" size={18} color={Colors.rose} />
                )}
              </TouchableOpacity>

              {categories.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.catPickerItem, pickedCatId === cat.id && styles.catPickerItemSelected]}
                  onPress={() => { setPickedCatId(cat.id); setPickedCatName(cat.name) }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.catPickerItemText, pickedCatId === cat.id && styles.catPickerItemTextSelected]}>
                    {cat.name}
                  </Text>
                  {pickedCatId === cat.id && (
                    <Ionicons name="checkmark-circle" size={18} color={Colors.rose} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.modalBtn} onPress={confirmUpload} activeOpacity={0.9}>
              <Text style={styles.modalBtnText}>Upload photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => { setShowCatPicker(false); setPendingAsset(null) }}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

// ── Photo card ────────────────────────────────────────────────────────────────

function PhotoCard({ item, onDelete }: { item: PortfolioItem; onDelete: (i: PortfolioItem) => void }) {
  return (
    <TouchableOpacity
      style={styles.gridItem}
      onLongPress={() => onDelete(item)}
      activeOpacity={0.85}
    >
      <Image source={{ uri: item.media_url }} style={styles.gridImg} resizeMode="cover" />
      {item.media_type === 'video' && (
        <View style={styles.playOverlay}>
          <Ionicons name="play-circle" size={28} color="rgba(255,255,255,0.9)" />
        </View>
      )}
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={() => onDelete(item)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="trash-outline" size={13} color={Colors.white} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  safe:      { flex: 1 },
  centred:   { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.white,
  },
  backBtn: { padding: 4, marginRight: 8 },
  title: { fontFamily: Fonts.display, flex: 1, fontSize: 26, color: Colors.rose },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.softPink + '40',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.softPink,
  },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.rose,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },

  scroll: { padding: 16 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontFamily: Fonts.display, fontSize: 26, color: Colors.rose, textAlign: 'center' },
  emptyText:  { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  emptyActions: { gap: 10, alignItems: 'center', marginTop: 8 },
  emptySecondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.softPink,
    backgroundColor: Colors.white,
  },
  emptySecondaryBtnText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.rose },
  addFirstBtn: {
    paddingHorizontal: 28, paddingVertical: 12,
    backgroundColor: Colors.rose, borderRadius: Radius.lg,
    ...Shadow.card,
  },
  addFirstBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.white },

  // Category section
  catSection: { marginBottom: 20 },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  catLabel: {
    fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridItem: {
    width: ITEM_SIZE, height: ITEM_SIZE, borderRadius: Radius.md,
    overflow: 'hidden', position: 'relative',
  },
  gridImg: { width: ITEM_SIZE, height: ITEM_SIZE },
  playOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  deleteBtn: {
    position: 'absolute', top: 5, right: 5,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },

  hint: { marginTop: 16, textAlign: 'center', fontSize: 12, color: Colors.muted },

  // Modal shared
  modalOuter: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    backgroundColor: Colors.cream, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 16,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 20,
  },
  modalTitle: {
    fontFamily: Fonts.display,
    fontSize: 26, color: Colors.rose,
    letterSpacing: -0.3, marginBottom: 6,
  },
  modalSub: { fontSize: 13, color: Colors.muted, marginBottom: 20, lineHeight: 18 },

  catInput: {
    backgroundColor: Colors.inputBg, borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.warmDark, marginBottom: 16,
  },
  modalBtn: {
    backgroundColor: Colors.rose, borderRadius: Radius.md,
    paddingVertical: 15, alignItems: 'center', marginBottom: 10,
    ...Shadow.card,
  },
  modalBtnDisabled: { backgroundColor: Colors.muted, shadowOpacity: 0, elevation: 0 },
  modalBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.white },
  modalCancel: {
    backgroundColor: Colors.white, borderRadius: Radius.md, paddingVertical: 15,
    alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  modalCancelText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.warmDark },

  // Category picker list
  catPickerList: { maxHeight: 240, marginBottom: 16 },
  catPickerItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.border,
  },
  catPickerItemSelected: { borderColor: Colors.rose, backgroundColor: Colors.softPink + '20' },
  catPickerItemText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.warmDark },
  catPickerItemTextSelected: { color: Colors.rose },
})
