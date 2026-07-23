// The annual report's visual constants, in one place so every component and
// the SFC draw from the same restrained palette and type ramp.

export const ink = {
  /** Near-black, green-tinted — body and headline ink. Never pure #000. */
  strong: '#1A2620',
  /** Secondary ink for supporting copy. */
  soft: '#535D56',
  /** Muted ink for captions, axis labels, small caps. */
  muted: '#8A938C',
} as const

export const accent = {
  base: '#315D3B',
  deep: '#223F2A',
  mid: '#6E9078',
} as const

export const paper = {
  page: '#FFFFFF',
  panel: '#F2F5F1',
  hairline: '#D3DAD3',
  hairlineStrong: '#AEB8B0',
} as const

/** A tonal green ramp for the donut, dark (largest) to pale, plus the accent. */
export const sectorTones = ['#9CB0A2', '#B0C0B4', '#C4D0C7', '#D8E0DA'] as const

/** Small-caps label styling shared by section eyebrows and tile labels. */
export const eyebrow = {
  color: accent.base,
  fontFamily: 'Inter',
  fontWeight: 600,
  fontSize: 8,
  letterSpacing: 1.6,
} as const
