import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildInfo, pageLoadedAt, isLocalPage, readLocalDiagnostics, usesLocalServices, type LocalDiagnostics } from '../lib/localDiagnostics'

/** No Firebase reads, account inspection, camera access, or remote telemetry. */
export function LocalStatus() {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [diagnostics, setDiagnostics] = useState<LocalDiagnostics | null>(null)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    if (!isLocalPage()) return
    const controller = new AbortController()
    let busy = false
    const check = async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      setChecking(true)
      const result = await readLocalDiagnostics(controller.signal)
      if (!controller.signal.aborted) {
        setDiagnostics(result)
        setChecked(true)
        setChecking(false)
      }
      busy = false
    }
    void check()
    const timer = window.setInterval(check, 20000)
    document.addEventListener('visibilitychange', check)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [attempt])

  const changed = diagnostics !== null && diagnostics.sourceHash !== buildInfo.sourceHash
  const serviceName = (available: boolean) => available ? (zh ? '可连接' : 'reachable') : (zh ? '未连接' : 'unreachable')
  return (
    <details className="local-status" style={{ margin: '12px 0', fontSize: 12, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
      <summary style={{ cursor: 'pointer' }}>
        {zh ? '页面版本' : 'Page version'} <code>{buildInfo.sourceHash}</code>
        {' · '}{buildInfo.mode === 'development' ? (zh ? '本机开发' : 'local development') : (zh ? '构建版本' : 'built version')}
        {changed && ` · ${zh ? '源码已变更' : 'source changed'}`}
        {usesLocalServices && diagnostics && (!diagnostics.services.auth || !diagnostics.services.firestore) && ` · ${zh ? '本机服务未连接' : 'local service unreachable'}`}
      </summary>
      <div aria-live="polite" style={{ padding: '8px 0' }}>
        <p>{buildInfo.mode === 'development' ? (zh ? '页面载入时间：' : 'Page loaded: ') : (zh ? '构建时间：' : 'Built: ')}{new Date(buildInfo.mode === 'development' ? pageLoadedAt : buildInfo.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}</p>
        {diagnostics && <p>{zh ? '本机当前源码：' : 'Current local source: '}<code>{diagnostics.sourceHash}</code></p>}
        {changed && (diagnostics.mode === 'preview' ? (
          <p role="status">{zh ? '正在预览的构建早于当前源码。请在 web 目录执行 npm run build，再刷新页面。' : 'This preview differs from the current source. Run npm run build in web, then reload the page.'}</p>
        ) : (
          <p role="status">{zh ? '载入页面后源码发生过变更。热更新可能只替换部分模块；完成当前操作后刷新，以载入一致版本。' : 'Source changed after this page loaded. Hot updates may replace only some modules; finish your current action, then reload for a consistent version.'}</p>
        ))}
        {usesLocalServices && diagnostics && <p>
          {zh ? '登录服务：' : 'Sign-in service: '}{serviceName(diagnostics.services.auth)}
          {' · '}{zh ? '产品目录服务：' : 'Product catalog service: '}{serviceName(diagnostics.services.firestore)}
        </p>}
        {usesLocalServices && diagnostics && (!diagnostics.services.auth || !diagnostics.services.firestore) && <p>
          {zh ? '在项目根目录运行 npm run emulators，保留终端运行，再点击检查状态。产品目录仍失败时，可在目录中重试。' : 'Run npm run emulators at the project root and leave that terminal running, then check again. Retry in the catalog if products still fail to load.'}
        </p>}
        {!usesLocalServices && <p>{zh ? '此版本使用已配置的 Firebase 服务；此处不检查远程账户或数据。' : 'This version uses configured Firebase services; remote accounts and data are not checked here.'}</p>}
        {isLocalPage() && checked && !diagnostics && <p>{zh ? '本机诊断不可用。请确认网页由更新后的 npm run dev 或 npm run preview 启动。' : 'Local diagnostics unavailable. Start the updated page with npm run dev or npm run preview.'}</p>}
        {usesLocalServices && diagnostics && <p>{zh ? '连接正常仅表示服务能响应；不代表已登录或产品数据已初始化。' : 'Reachable means the service responds; it does not confirm sign-in or populated product data.'}</p>}
        {isLocalPage() && <button type="button" className="tool" disabled={checking} onClick={refresh}>
          {checking ? (zh ? '正在检查…' : 'Checking…') : (zh ? '检查状态' : 'Check status')}
        </button>}
      </div>
    </details>
  )
}
