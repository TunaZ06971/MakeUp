import type { Timestamp } from 'firebase/firestore'

export const MAKEUP_CATEGORIES = [
  'lipstick',
  'eyeshadow',
  'blush',
  'foundation',
  'eyeliner',
  'brow',
  'highlighter',
] as const
export type MakeupCategory = (typeof MAKEUP_CATEGORIES)[number]

export const FINISH_TYPES = [
  'matte',
  'satin',
  'shimmer',
  'glitter',
  'metallic',
  'sheer',
  'dewy',
] as const
export type FinishType = (typeof FINISH_TYPES)[number]

export const APPLICABLE_REGIONS = [
  'lips',
  'eyelid',
  'crease',
  'eyelidLine',
  'waterline',
  'eyebrows',
  'cheeks',
  'cheekbones',
  'noseBridge',
  'cupidsBow',
  'faceFull',
] as const
export type ApplicableRegion = (typeof APPLICABLE_REGIONS)[number]

export type AppLanguage = 'zh' | 'en'

export interface UserProfile {
  uid: string
  email: string
  displayName: string
  preferredLanguage: AppLanguage
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface ProductColor {
  hex: string
  label?: string
}

export interface Product {
  id: string
  brand: string
  brandZh?: string
  shadeName: string
  shadeNameZh?: string
  category: MakeupCategory
  colors: ProductColor[]
  finish: FinishType
  opacity?: number
  applicableRegions: ApplicableRegion[]
  textureAsset?: string
  source: 'curated_v1' | 'partner_feed'
  sourceId?: string
  searchKeywords: string[]
  isActive: boolean
  schemaVersion: number
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface AppliedProduct {
  productId: string
  region: ApplicableRegion
  colorIndex: number
  intensity: number
  order: number
}

export interface Look {
  id: string
  ownerUid: string
  title: string
  appliedProducts: AppliedProduct[]
  createdAt: Timestamp
  updatedAt: Timestamp
}
