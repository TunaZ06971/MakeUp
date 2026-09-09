import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeImage, deleteFacePhoto, listFacePhotos, saveFacePhoto, type FacePhotoRecord } from '../../lib/localPhotoStore'
import { detectFace, type FaceDetection } from '../render-engine/landmarks/mediapipeClient'

export interface FaceView {
  record: FacePhotoRecord
  bitmap: ImageBitmap
  detection: FaceDetection | null
  thumbnailUrl: string
  status: 'detecting' | 'detected' | 'noFace' | 'failed'
}
function release(view: FaceView) { view.bitmap.close(); URL.revokeObjectURL(view.thumbnailUrl) }

export function usePhotoLibrary(uid: string | undefined) {
  const [views, setViews] = useState<FaceView[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const epoch = useRef(0)
  const resources = useRef(new Set<FaceView>())

  const ingest = useCallback(async (record: FacePhotoRecord): Promise<FaceView> => {
    const bitmap = await decodeImage(record.blob)
    const view: FaceView = { record, bitmap, detection: null, thumbnailUrl: URL.createObjectURL(record.thumbnail), status: 'detecting' }
    try { view.detection = await detectFace(bitmap); view.status = view.detection ? 'detected' : 'noFace' }
    catch { view.status = 'failed' }
    return view
  }, [])

  useEffect(() => {
    const lifecycle = epoch
    const generation = ++lifecycle.current
    const ownedResources = resources.current
    if (!uid) return
    void (async () => {
      const loaded: FaceView[] = []
      try {
        const records = await listFacePhotos(uid)
        for (const record of records) {
          if (epoch.current !== generation) break
          const view = await ingest(record)
          if (epoch.current !== generation) { release(view); break }
          resources.current.add(view); loaded.push(view)
        }
        if (epoch.current === generation) {
          setViews(loaded); setActiveId(loaded[0]?.record.id ?? null)
        }
      } catch { if (epoch.current === generation) setError(true) }
      finally { if (epoch.current === generation) setLoadedFor(uid) }
    })()
    return () => {
      ++lifecycle.current
      for (const view of ownedResources) release(view)
      ownedResources.clear()
    }
  }, [uid, ingest])

  const addPhotos = useCallback(async (files: File[]) => {
    if (!uid || busy) return
    const generation = epoch.current
    setBusy(true); setError(false)
    try {
      for (const file of files) {
        if (generation !== epoch.current) break
        try {
          const record = await saveFacePhoto(file, uid)
          const view = await ingest(record)
          if (generation !== epoch.current) { release(view); break }
          resources.current.add(view)
          setViews(previous => [...previous, view]); setActiveId(view.record.id)
        } catch { if (generation === epoch.current) setError(true) }
      }
    } finally { if (generation === epoch.current) setBusy(false) }
  }, [uid, busy, ingest])

  const removePhoto = useCallback(async (id: string) => {
    const generation = epoch.current
    try {
      await deleteFacePhoto(id)
      if (generation !== epoch.current) return
      const target = views.find(view => view.record.id === id)
      if (target) { resources.current.delete(target); release(target) }
      const next = views.filter(view => view.record.id !== id)
      setViews(next); setActiveId(current => current === id ? next[0]?.record.id ?? null : current)
    } catch { if (generation === epoch.current) setError(true) }
  }, [views])
  const visible = views.filter(view => view.record.ownerUid === uid)
  return { views: visible, active: visible.find(view => view.record.id === activeId) ?? null, activeId, setActiveId,
    addPhotos, removePhoto, loading: busy || (Boolean(uid) && loadedFor !== uid), error }
}
