// Pink theme. Token NAMES are kept stable (rose/roseDark/softPink/…) so every existing
// `Colors.*` reference across the app recolours centrally; only the values changed.

export const CategoryColors = {
  // Unified pink — categories share the primary accent (was per-category multi-colour).
  nails:    '#F5388F',
  lashes:   '#F5388F',
  brows:    '#F5388F',
  hair:     '#F5388F',
  makeup:   '#F5388F',
  sprayTan: '#F5388F',
} as const

export const Colors = {
  rose:        '#DB4B86',  // primary pink — CTAs, active states, links, wordmark (muted rose)
  roseDark:    '#C23A71',  // deep pink — pressed / dark CTA
  softPink:    '#FFE3EF',  // light pink — accent fills, inactive chips, gradient top
  pinkVibrant: '#DB4B86',  // unread accent (kept in the pink family)
  cream:       '#FFF7FA',  // very light pink — page background
  warmDark:    '#2B2531',  // near-black plum — heading / primary text
  white:       '#FFFFFF',  // card surfaces
  error:       '#DC2626',  // error states
  border:      '#F6E1EA',  // soft pink borders
  muted:       '#6E6675',  // darker plum-grey — readable secondary text
  inputBg:     '#FFF0F6',  // pink-tint input / chip / badge background
} as const

// ── Design tokens (new) ───────────────────────────────────────────────────────

export const Fonts = {
  display:  'Fredoka_600SemiBold',  // chunky rounded wordmark / big headings
  heading:  'Quicksand_700Bold',    // section titles / subheads
  body:     'Quicksand_400Regular',
  bodyBold: 'Quicksand_700Bold',
} as const

export const Radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const

export const Shadow = {
  // Soft pink-tinted card lift.
  card: {
    shadowColor: '#F5388F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 3,
  },
  // Subtle neutral lift for smaller surfaces.
  soft: {
    shadowColor: '#2B2531',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
} as const

// Pink→white gradient for headers (use with expo-linear-gradient).
export const PinkGradient = ['#FFE3EF', '#FFF7FA'] as const
