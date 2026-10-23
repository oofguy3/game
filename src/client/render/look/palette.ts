/** The natural colours of the new look, 0xRRGGBB. The shader, the flat fallback and the minimap all use them. */
export const LOOK = {
  deepWater: 0x1d4e7a,
  shallowWater: 0x3f86b5,
  /** One water colour for the flat picture. */
  water: 0x2b6596,
  sand: 0xe2d3a0,
  plains: 0x86ad5e,
  hills: 0x9c9a63,
  mountains: 0x8b8173,
  forest: 0x3f6e3c,
  dry: 0xc8b27b,
  snow: 0xf1f4f6,
} as const;
