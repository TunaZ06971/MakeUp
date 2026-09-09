import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LocalStatus } from '../../components/LocalStatus'
import { LanguageToggle } from '../../components/LanguageToggle'
import { download } from '../face-scan/scanModel'
import { appendSegment, captureBytes, deleteCapture, loadCapture, MAX_SEGMENTS, saveCapture, type CaptureFrame, type CaptureSegment, type HeadCapture } from './captureStore'
import { exportCapture, importCapture } from './captureArchive'
import { startRecording, type RecordingProgress } from './recording'
import { MAX_CLIP_MS, VIEW_NAMES } from './selection'

// A dedicated local workspace is usable even when the login service is unavailable.
const OWNER = 'device-local'
function useBlobURL(blob?: Blob) {
  const [url, setURL] = useState('')
  // Object URLs are browser resources, allocated and revoked with the effect lifetime.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (!blob) return; const value = URL.createObjectURL(blob); setURL(value); return () => URL.revokeObjectURL(value) }, [blob])
  return url
}
function Keyframe({ frame }: { frame: CaptureFrame }) {
  const { t } = useTranslation(), url = useBlobURL(frame.image)
  return <figure><img src={url || undefined} alt={t(`capture.views.${frame.view}`)} /><figcaption>{t(`capture.views.${frame.view}`)} · {(frame.timeMs / 1000).toFixed(1)}s</figcaption></figure>
}
function RecordedClip({ segment }: { segment: CaptureSegment }) {
  const { t } = useTranslation(), url = useBlobURL(segment.video)
  return <figure><video src={url || undefined} controls playsInline preload="metadata" /><figcaption>{(segment.durationMs / 1000).toFixed(1)}s · {segment.width} × {segment.height} · {t(`capture.ended.${segment.ended}`)}</figcaption></figure>
}
function Coverage({ frames }: { frames: CaptureFrame[] }) {
  const { t } = useTranslation()
  return <ul className="capture-coverage" aria-label={t('capture.coverage')}>
    {VIEW_NAMES.map(view => { const count = frames.filter(f => f.view === view).length; return <li className={count ? 'observed' : ''} key={view} data-view={view} data-count={count}><span>{count ? '✓' : '○'} {t(`capture.views.${view}`)}</span><small>{count ? t('capture.candidates', { count }) : t('capture.noCandidates')}</small></li> })}
  </ul>
}
function Recorder({ side, previous, onFinished }: { side: 'left' | 'right'; previous: CaptureFrame[]; onFinished: (segment: CaptureSegment | null, issue: string) => Promise<void> }) {
  const { t } = useTranslation(), video = useRef<HTMLVideoElement>(null), controller = useRef<ReturnType<typeof startRecording> | null>(null)
  const [state, setState] = useState<RecordingProgress>({ elapsedMs: 0, frames: [], analyzedFrames: 0, issue: 'starting', recording: false })
  const [stopping, setStopping] = useState(false), latestIssue = useRef('starting')
  useEffect(() => {
    let live = true
    let session: ReturnType<typeof startRecording> | undefined
    // Defer device access until after React's development effect probe.
    const timer = window.setTimeout(() => {
      session = startRecording(video.current!, value => { latestIssue.current = value.issue; if (live) setState(value) })
      controller.current = session
      void session.done.then(async segment => {
        if (!live && !segment) return
        if (live) setStopping(true)
        await onFinished(segment, latestIssue.current)
      })
    }, 0)
    return () => { live = false; clearTimeout(timer); void session?.stop('background') }
  }, [onFinished])
  const frames = [...previous, ...state.frames], hasFront = frames.some(f => f.view === 'front'), hasSide = frames.some(f => f.view === side || f.view === `${side}Side`)
  return <section className="capture-live card" aria-label={t('capture.recording')}>
    <div className="capture-camera"><video ref={video} muted playsInline /><div className="capture-head-guide" /><span>{t('capture.localOnly')}</span></div>
    <div className="capture-instruction" aria-live="polite">
      <h2>{stopping ? t('capture.saving') : !hasFront ? t('capture.frontHint') : !hasSide ? t(`capture.turn.${side}`) : t('capture.returnHint')}</h2>
      <p>{!state.recording && state.issue === 'starting' ? t('capture.feedback.permission') : state.issue ? t(`capture.feedback.${state.issue}`) : t('capture.keepRecording')}</p>
      <label>{t('capture.elapsed')} · {(state.elapsedMs / 1000).toFixed(0)} / {MAX_CLIP_MS / 1000}s<progress max={MAX_CLIP_MS} value={state.elapsedMs} /></label>
    </div>
    <Coverage frames={frames} />
    <p className="capture-note">{t('capture.coverageNotice')}</p>
    <button className="button" disabled={stopping} onClick={() => { setStopping(true); void controller.current?.stop() }}>{stopping ? t('capture.saving') : t('capture.finish')}</button>
  </section>
}

export function CapturePage() {
  const { t } = useTranslation()
  const [capture, setCapture] = useState<HeadCapture | null>(null), [loading, setLoading] = useState(true), [side, setSide] = useState<'left' | 'right'>('left')
  const [recording, setRecording] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false)
  const [unsaved, setUnsaved] = useState<CaptureSegment | null>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!recording && !busy && !unsaved) return
    // Hard reload/close can destroy MediaRecorder before its final chunk is emitted.
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [recording, busy, unsaved])
  useEffect(() => { let live = true; void loadCapture(OWNER).then(c => { if (live) { setCapture(c); if (c) setSide(c.intendedSide) } }).catch(() => { if (live) setError('load') }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [])
  const finish = useCallback(async (segment: CaptureSegment | null, issue: string) => {
    try {
      if (!segment) { setError(['denied', 'secure', 'unsupported', 'cameraError'].includes(issue) ? issue : 'empty'); return }
      setCapture(await appendSegment(OWNER, segment, side)); setUnsaved(null); setError('')
    } catch { setUnsaved(segment); setError('save') }
    finally { setRecording(false) }
  }, [side])
  const frames = capture?.segments.flatMap(s => s.frames) ?? []
  const hasFront = frames.some(f => f.view === 'front'), hasSide = frames.some(f => f.view === side || f.view === `${side}Side`)
  const run = async (action: () => Promise<void>, issue: string) => { setBusy(true); setError(''); try { await action() } catch { setError(issue) } finally { setBusy(false) } }
  return <div className="shell capture-page">
    <header className="shell__header"><div><p className="eyebrow">MakeUp · {t('capture.localOnly')}</p><h1 className="shell__title">{t('capture.title')}</h1><p>{t('capture.subtitle')}</p></div><div className="shell__actions"><LanguageToggle />{!recording && <Link className="tool" to="/">{t('capture.studio')}</Link>}</div></header>
    <LocalStatus />
    {error && <p className="form__error" role="alert">{t(`capture.errors.${error}`)}</p>}
    {unsaved && <div className="card"><p>{t('capture.unsaved')}</p><button className="tool" onClick={() => download(unsaved.video, `MakeUp-unsaved.${unsaved.video.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`)}>{t('capture.saveRaw')}</button> <button className="tool" disabled={busy} onClick={() => void run(() => finish(unsaved, ''), 'save')}>{t('capture.retrySave')}</button></div>}
    {recording ? <Recorder side={side} previous={frames} onFinished={finish} /> : <>
      <section className="card capture-intro">
        <div><span className="capture-step">01</span><h2>{t(capture ? 'capture.addTitle' : 'capture.startTitle')}</h2><p>{t('capture.instructions')}</p><p>{t('capture.framing')}</p></div>
        <div className="capture-controls"><label>{t('capture.side')}<select disabled={!!capture} value={side} onChange={e => setSide(e.target.value as 'left' | 'right')}><option value="left">{t('capture.left')}</option><option value="right">{t('capture.right')}</option></select></label><button className="button" disabled={loading || busy || !!unsaved || (capture?.segments.length ?? 0) >= MAX_SEGMENTS} onClick={() => { setError(''); setRecording(true) }}>{t(capture ? 'capture.addClip' : 'capture.start')}</button><p className="capture-note">{t('capture.recordingLimit', { count: MAX_SEGMENTS })}</p></div>
      </section>
      {loading ? <p>{t('capture.loading')}</p> : capture && <section className="card capture-review">
        <span className="capture-step">02</span><h2>{t('capture.saved')}</h2><p>{t(hasFront && hasSide ? 'capture.available' : 'capture.incomplete')}</p>
        <Coverage frames={frames} /><p className="capture-note">{t('capture.coverageNotice')}</p>
        <div className="capture-clips">{capture.segments.map(s => <RecordedClip key={s.id} segment={s} />)}</div>
        <details><summary>{t('capture.selectedFrames', { count: frames.length })}</summary><div className="capture-frames">{frames.map(f => <Keyframe key={f.id} frame={f} />)}</div></details>
        <p>{t('capture.size', { count: capture.segments.length, size: (captureBytes(capture) / 1_000_000).toFixed(1) })}</p>
        <div className="capture-actions"><button className="button" disabled={busy} onClick={() => void run(async () => download(await exportCapture(capture), 'MakeUp-head.makeupcapture'), 'export')}>{t('capture.export')}</button><button className="tool" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('capture.delete')}</button></div>
        {confirmDelete && <div className="capture-confirm" role="alert"><p>{t('capture.deleteNotice')}</p><button className="tool" onClick={() => void run(async () => { await deleteCapture(OWNER); setCapture(null); setConfirmDelete(false) }, 'save')}>{t('capture.confirmDelete')}</button><button className="tool" onClick={() => setConfirmDelete(false)}>{t('capture.cancel')}</button></div>}
      </section>}
      <section className="card capture-model-status"><span className="capture-step">03</span><h2>{t('capture.modelTitle')}</h2><p>{t('capture.modelPending')}</p><p className="capture-note">{t('capture.budget')}</p><Link className="tool" to="/">{t('capture.existingModels')}</Link></section>
      <section className="capture-transfer"><button className="tool" disabled={loading || busy || !!capture} onClick={() => file.current?.click()}>{t('capture.import')}</button><p className="capture-note">{t('capture.importNotice')}</p><input ref={file} className="visually-hidden" type="file" accept=".makeupcapture,.zip" aria-label={t('capture.import')} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(async () => { if (capture) throw Error('Capture exists'); const value = await importCapture(f); await saveCapture(OWNER, value); setCapture(value); setSide(value.intendedSide) }, 'import') }} /></section>
    </>}
    <p className="capture-note">{t('capture.privacy')}</p>
  </div>
}
