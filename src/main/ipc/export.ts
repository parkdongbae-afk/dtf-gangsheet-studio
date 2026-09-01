/**
 * 내보내기 사이드카 IPC (S6 세션 2) — Electron 메인 ↔ Python NDJSON 클라이언트.
 *
 * - S6-1에서 확립한 프로토콜 그대로: `python -u server.py` 스폰, NDJSON
 *   JSON-RPC 2.0 (ping/render/shutdown), UTF-8 파이프, 매 줄 flush 상대
 *   읽기는 readline으로 즉시 처리한다.
 * - 응답 구분: "method" 키가 있으면 progress 알림(id 없음), 없으면 요청 응답
 *   (id 매칭) — server.py 계약과 대칭.
 * - 진행률은 렌더러에 `export:progress` 이벤트로 push. 취소는 자식 프로세스
 *   종료로 수행하며 다음 요청 때 사이드카가 자동 재시작된다.
 * - 파이썬 경로: DTF_SIDECAR_PYTHON 환경변수 → export-sidecar/.venv → PATH
 *   `python` (S7 PyInstaller 번들 시 경로 정책만 교체).
 */
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ExportManifest } from '../../workers/exportManifest'
import type { ExportProgress, ExportResult } from '../../types/ipc'

const PING_TIMEOUT_MS = 10_000
const SHUTDOWN_TIMEOUT_MS = 3_000
/** 스폰 실패 진단용 stderr 꼬리 상한 */
const STDERR_TAIL_CHARS = 2_000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface JsonRpcError {
  code: number
  message: string
}

/** 사이드카 스폰·요청·알림 수신을 관리 — 렌더 1회마다 재사용되는 장수 클라이언트 */
class SidecarManager {
  private child: ChildProcess | null = null
  private stdin: NodeJS.WritableStream | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private stderrTail = ''
  private rendering = false
  private onProgress: ((progress: ExportProgress) => void) | null = null

  /** 렌더 진행 — render 호출부가 설정, 렌더 종료 시 해제 */
  set onProgressHandler(handler: ((progress: ExportProgress) => void) | null) {
    this.onProgress = handler
  }

  private resolvePython(): string {
    const override = process.env.DTF_SIDECAR_PYTHON
    if (override) return override
    const appPath = app.getAppPath()
    const candidates =
      process.platform === 'win32'
        ? [join(appPath, 'export-sidecar', '.venv', 'Scripts', 'python.exe')]
        : [join(appPath, 'export-sidecar', '.venv', 'bin', 'python')]
    const found = candidates.find((p) => existsSync(p))
    return found ?? 'python'
  }

  private resolveServerPath(): string {
    return join(app.getAppPath(), 'export-sidecar', 'server.py')
  }

  private spawnProcess(): void {
    const python = this.resolvePython()
    const child = spawn(python, ['-u', this.resolveServerPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    this.stdin = child.stdin

    child.stdout?.setEncoding('utf-8')
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => this.handleLine(line))

    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_CHARS)
    })

    child.on('error', (err) => this.failAllPending(new Error(`사이드카 실행 실패: ${err.message}`)))
    child.on('exit', () => {
      if (this.child === child) {
        this.child = null
        this.stdin = null
        this.failAllPending(new Error('사이드카가 예기치 않게 종료되었습니다'))
      }
    })
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    let message: object
    try {
      message = JSON.parse(trimmed) as object
    } catch {
      console.error(`[sidecar] 프로토콜 위반 라인 무시: ${trimmed.slice(0, 200)}`)
      return
    }
    if ('method' in message && typeof (message as { method: unknown }).method === 'string') {
      this.dispatchNotification(message as { method: string; params?: unknown })
      return
    }
    this.dispatchResponse(message as { id?: unknown; result?: unknown; error?: JsonRpcError })
  }

  private dispatchNotification(message: { method: string; params?: unknown }): void {
    if (message.method !== 'progress' || !this.onProgress) return
    const params = message.params as ExportProgress | undefined
    if (
      params &&
      (params.stage === 'items' || params.stage === 'write') &&
      typeof params.current === 'number' &&
      typeof params.total === 'number'
    ) {
      this.onProgress(params)
    }
  }

  private dispatchResponse(message: {
    id?: unknown
    result?: unknown
    error?: JsonRpcError
  }): void {
    const id = typeof message.id === 'number' ? message.id : null
    if (id === null) return
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    if (message.error) {
      pending.reject(new Error(`사이드카 오류(${message.error.code}): ${message.error.message}`))
    } else {
      pending.resolve(message.result)
    }
  }

  private failAllPending(error: Error): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const entry of pending) entry.reject(error)
  }

  private writeRequest(method: string, params?: unknown): number {
    if (!this.stdin) throw new Error('사이드카가 실행 중이 아닙니다')
    const id = this.nextId++
    const request: Record<string, unknown> = { jsonrpc: '2.0', id, method }
    if (params !== undefined) request.params = params
    this.stdin.write(`${JSON.stringify(request)}\n`)
    return id
  }

  private request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.writeRequest(method, params)
    return new Promise((resolve, reject) => {
      const entry: PendingRequest = { resolve, reject }
      this.pending.set(id, entry)
      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          if (this.pending.delete(id)) {
            entry.reject(
              new Error(
                `사이드카 ${method} 응답 대기 시간 초과(${timeoutMs}ms) — ${this.stderrTail}`
              )
            )
          }
        }, timeoutMs)
        entry.resolve = (value) => {
          clearTimeout(timer)
          resolve(value)
        }
        entry.reject = (error) => {
          clearTimeout(timer)
          reject(error)
        }
      }
    })
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed && this.stdin) return
    this.spawnProcess()
    await this.request('ping', undefined, PING_TIMEOUT_MS)
  }

  /** 매니페스트 렌더 — 진행 알림은 handler로, 결과는 메타데이터만 반환 */
  async render(
    manifest: ExportManifest,
    onProgress: (progress: ExportProgress) => void
  ): Promise<ExportResult> {
    if (this.rendering) throw new Error('이미 내보내기가 진행 중입니다')
    this.rendering = true
    this.onProgress = onProgress
    try {
      await this.ensureStarted()
      const result = (await this.request('render', manifest)) as Partial<ExportResult>
      if (
        typeof result.output_path !== 'string' ||
        typeof result.width_px !== 'number' ||
        typeof result.height_px !== 'number' ||
        typeof result.layer_count !== 'number' ||
        typeof result.duration_ms !== 'number'
      ) {
        throw new Error(`사이드카 응답 스키마 위반: ${JSON.stringify(result).slice(0, 300)}`)
      }
      return result as ExportResult
    } finally {
      this.rendering = false
      this.onProgress = null
    }
  }

  /** 진행 중 렌더 취소 — 프로세스 종료로 pending 요청이 거부된다 */
  cancel(): void {
    const child = this.child
    this.child = null
    this.stdin = null
    if (child && !child.killed) child.kill()
    this.failAllPending(new Error('내보내기가 취소되었습니다'))
  }

  /** 앱 종료 정리 — shutdown 요청 후 여유 시간 두고 kill */
  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    try {
      await this.request('shutdown', undefined, SHUTDOWN_TIMEOUT_MS)
    } catch {
      // 응답 없거나 이미 종료 — 아래 kill으로 마무리
    }
    if (!child.killed) child.kill()
  }
}

function saveDialogFilters(format: 'psd' | 'png'): Electron.FileFilter[] {
  return format === 'psd'
    ? [{ name: 'Photoshop 문서 (CMYK·350DPI)', extensions: ['psd'] }]
    : [{ name: 'PNG 이미지 (알파 보존)', extensions: ['png'] }]
}

const sidecar = new SidecarManager()

export function registerExportIpc(): void {
  ipcMain.handle('export:save-dialog', async (event, format: unknown): Promise<string | null> => {
    if (format !== 'psd' && format !== 'png') {
      throw new Error('내보내기 포맷은 "psd" 또는 "png"여야 합니다')
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: format === 'psd' ? 'PSD 내보내기' : 'PNG 내보내기',
      defaultPath: `gangsheet.${format}`,
      filters: saveDialogFilters(format)
    }
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('export:render', async (event, manifest: unknown): Promise<ExportResult> => {
    if (typeof manifest !== 'object' || manifest === null) {
      throw new Error('내보내기 매니페스트가 올바르지 않습니다')
    }
    return sidecar.render(manifest as ExportManifest, (progress) => {
      event.sender.send('export:progress', progress)
    })
  })

  ipcMain.handle('export:cancel', () => {
    sidecar.cancel()
  })

  app.on('will-quit', () => {
    sidecar.cancel()
  })
}

/**
 * E2E 자동검증 훅 (DTF_SMOKE_TEST 패턴 계승) — DTF_EXPORT_TEST=<매니페스트 경로>로
 * 실행하면 IPC와 동일한 SidecarManager 경로로 렌더하고 결과 JSON을
 * `<매니페스트 경로>.result.json`에 남긴 뒤 앱을 종료한다.
 */
export async function runExportTestHook(): Promise<void> {
  const manifestPath = process.env.DTF_EXPORT_TEST
  if (!manifestPath) return
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ExportManifest
  const reportPath = `${manifestPath}.result.json`
  const started = Date.now()
  try {
    const result = await sidecar.render(manifest, (progress) => {
      console.log(`[export-test] ${JSON.stringify(progress)}`)
    })
    writeFileSync(
      reportPath,
      JSON.stringify({ ok: true, result, elapsed_ms: Date.now() - started }, null, 2),
      'utf-8'
    )
    console.log(`[export-test] OK -> ${reportPath}`)
  } catch (err) {
    writeFileSync(
      reportPath,
      JSON.stringify(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        null,
        2
      ),
      'utf-8'
    )
    console.error(`[export-test] FAILED: ${String(err)}`)
  } finally {
    await sidecar.stop()
    app.quit()
  }
}
