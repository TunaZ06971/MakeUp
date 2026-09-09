import type { FinishType, MakeupCategory } from '../../../types/models'
import materials from './materials.json'

/** Artistic presets, not measured product BRDFs. Shared verbatim with Metal. */
export interface FinishParams {
  gloss: number
  roughness: number
  detail: number
  coverage: number
  sparkle: number
}
export const FINISH_PARAMS: Record<FinishType, FinishParams> = materials
export const CATEGORY_OPACITY: Record<MakeupCategory, number> = {
  lipstick: 0.98, foundation: 0.40, blush: 0.28, eyeshadow: 0.65,
  eyeliner: 0.99, brow: 0.78, highlighter: 0.22,
}
