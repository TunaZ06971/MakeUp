import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { filterProducts } from '../../lib/firestore/products'
import { MAKEUP_CATEGORIES, type MakeupCategory, type Product } from '../../types/models'
import { ProductCard } from './ProductCard'
import { useProducts } from './useProducts'

interface CatalogPanelProps {
  selectedId?: string
  onSelect?: (product: Product) => void
}

export function CatalogPanel({ selectedId, onSelect }: CatalogPanelProps) {
  const { t, i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [category, setCategory] = useState<MakeupCategory | undefined>()
  const [term, setTerm] = useState('')
  const { products, loading, error, errorKind, retry } = useProducts(category)

  const visible = useMemo(() => filterProducts(products, term), [products, term])

  return (
    <section className="card">
      <div className="face__header">
        <h2 className="card__title">{t('catalog.title')}</h2>
        <input
          className="field__input catalog__search"
          type="search"
          placeholder={t('catalog.searchPlaceholder')}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      <div className="chips" role="tablist" aria-label={t('catalog.title')}>
        <button
          type="button"
          role="tab"
          className="chip"
          aria-selected={category === undefined}
          onClick={() => setCategory(undefined)}
        >
          {t('catalog.all')}
        </button>
        {MAKEUP_CATEGORIES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="chip"
            aria-selected={category === value}
            onClick={() => setCategory(value)}
          >
            {t(`category.${value}`)}
          </button>
        ))}
      </div>

      {loading && <p className="catalog__status">{t('catalog.loading')}</p>}
      {error && <div role="alert" className="form__error">
        <p>{errorKind === 'service-unavailable'
          ? (zh ? '本机产品目录服务未连接。在项目根目录运行 npm run emulators，保留终端运行后重试。' : 'The local product catalog service is unreachable. Run npm run emulators at the project root, leave the terminal running, then retry.')
          : errorKind === 'timeout'
            ? (zh ? '产品加载超时。请检查服务状态后重试。' : 'Loading products timed out. Check service status, then retry.')
            : errorKind === 'permission-denied'
              ? (zh ? '产品读取权限被拒绝。请确认已经登录，再重试。' : 'Product access was denied. Make sure you are signed in, then retry.')
              : t('catalog.error')}</p>
        <button type="button" className="btn btn--ghost" onClick={retry}>{zh ? '重新加载产品' : 'Retry loading products'}</button>
      </div>}
      {!loading && !error && visible.length === 0 && (
        <p className="catalog__status">{t('catalog.empty')}</p>
      )}

      {visible.length > 0 && (
        <div className="products">
          {visible.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              selected={product.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  )
}
