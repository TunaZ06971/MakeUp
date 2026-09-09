import { useTranslation } from 'react-i18next'
import type { Product } from '../../types/models'

interface ProductCardProps {
  product: Product
  selected?: boolean
  onSelect?: (product: Product) => void
}

export function ProductCard({ product, selected = false, onSelect }: ProductCardProps) {
  const { t, i18n } = useTranslation()
  const zh = i18n.language === 'zh'
  const brand = (zh && product.brandZh) || product.brand
  const shade = (zh && product.shadeNameZh) || product.shadeName

  return (
    <button
      type="button"
      className="product"
      aria-pressed={selected}
      onClick={() => onSelect?.(product)}
    >
      <span
        className="product__swatch"
        style={{
          // Multi-tone products (palettes, ombré lips) show every tone.
          background:
            product.colors.length > 1
              ? `linear-gradient(135deg, ${product.colors.map((color) => color.hex).join(', ')})`
              : product.colors[0]?.hex,
        }}
      />
      <span className="product__text">
        <span className="product__brand">{brand}</span>
        <span className="product__shade">{shade}</span>
        <span className="product__finish">{t(`finish.${product.finish}`)}</span>
      </span>
    </button>
  )
}
