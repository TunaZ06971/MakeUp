/** Parses `#RRGGBB` into sRGB components in 0..1 — the form the shaders take. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const digits = hex.startsWith('#') ? hex.slice(1) : hex
  if (digits.length !== 6) return null
  const value = Number.parseInt(digits, 16)
  if (Number.isNaN(value)) return null
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255]
}
