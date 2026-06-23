import { useMemo } from 'react'
import { View, StyleSheet, Dimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/Colors'

// ── Tunables (one-number dials) ───────────────────────────────────────────────

const DEFAULT_OPACITY = 0.04   // overall faintness of the whole motif layer
const DEFAULT_DENSITY = 1      // motif-count multiplier (higher = more, closer together)
const BASE_GAP        = 76     // base px gap between motif cells at density 1

// ── Motifs ────────────────────────────────────────────────────────────────────

type IconName = keyof typeof Ionicons.glyphMap

// A dainty beauty mix — scissors, hearts, florals, sparkles, comb/brush.
const MOTIFS: IconName[] = [
  'cut',              // scissors
  'cut-outline',
  'heart-outline',
  'flower',
  'flower-outline',
  'sparkles',
  'sparkles-outline',
  'rose',
  'rose-outline',
  'brush-outline',    // comb / brush
]

const TINTS = [Colors.rose, Colors.softPink]

// Deterministic PRNG so the scatter is stable across re-renders (no flicker).
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  /** Overall faintness of the motif layer. Default 0.04 (~4%). */
  opacity?: number
  /** Motif-count multiplier. Higher packs more motifs in. Default 1. */
  density?: number
}

export default function PatternBackground({
  opacity = DEFAULT_OPACITY,
  density = DEFAULT_DENSITY,
}: Props) {
  const motifs = useMemo(() => {
    // Overscan a little past the window so edges stay covered.
    const { width, height } = Dimensions.get('window')
    const step = BASE_GAP / Math.max(density, 0.1)
    const cols = Math.ceil(width / step) + 1
    const rows = Math.ceil(height / step) + 1

    const rand = mulberry32(0x9e3779b1) // fixed seed → stable, hand-scattered layout
    const out: {
      key: string
      name: IconName
      left: number
      top: number
      size: number
      rotate: number
      color: string
    }[] = []

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Cell origin + per-cell jitter → organic scatter, not a rigid grid.
        const jx = (rand() - 0.5) * step * 0.9
        const jy = (rand() - 0.5) * step * 0.9
        out.push({
          key: `${r}-${c}`,
          name: MOTIFS[Math.floor(rand() * MOTIFS.length)],
          left: c * step + jx,
          top: r * step + jy,
          size: 18 + Math.floor(rand() * 13), // ~18–30
          rotate: Math.floor(rand() * 360),
          color: TINTS[Math.floor(rand() * TINTS.length)],
        })
      }
    }
    return out
  }, [density])

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      {/* Single opacity dial for the whole motif layer; cream base stays solid. */}
      <View style={[StyleSheet.absoluteFill, { opacity }]}>
        {motifs.map(m => (
          <Ionicons
            key={m.key}
            name={m.name}
            size={m.size}
            color={m.color}
            style={{
              position: 'absolute',
              left: m.left,
              top: m.top,
              transform: [{ rotate: `${m.rotate}deg` }],
            }}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  base: { backgroundColor: Colors.cream },
})
