import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { MakeupCategory, Product } from '../../types/models'

function toProduct(snapshot: QueryDocumentSnapshot): Product {
  return { id: snapshot.id, ...snapshot.data() } as Product
}

/** Passing no category returns the whole active catalog. */
export async function fetchProducts(category?: MakeupCategory): Promise<Product[]> {
  const constraints = [
    ...(category ? [where('category', '==', category)] : []),
    where('isActive', '==', true),
    orderBy('createdAt', 'desc'),
  ]
  const snapshot = await getDocs(query(collection(db, 'products'), ...constraints))
  return snapshot.docs.map(toProduct)
}

/** Client-side filter over an already-loaded page — the catalog is small. */
export function filterProducts(products: Product[], term: string): Product[] {
  const needle = term.trim().toLowerCase()
  if (!needle) return products
  return products.filter((product) =>
    product.searchKeywords.some((keyword) => keyword.includes(needle)),
  )
}
