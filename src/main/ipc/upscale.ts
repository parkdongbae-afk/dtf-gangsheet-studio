/**
 * 업스케일 IPC — UPSCALER.MD v2.0의 Electron 통합 지점.
 *
 * 흐름: 렌더러가 원본 경로 + 옵션만 전달 → 메인이 헤더에서 실제 치수 판독 →
 * 공유 Plan Builder(src/core/upscaler/plan.ts, 렌더러 예상 패널과 동일 함수)로
 * 계획 재수립 — "표시된 예상 = 실행 계획" 보장 → 사이드카 ``upscale``에 체인을
 * 통째로 위임(STDIO 경로 계약) → ``userData/upscale/<uuid>/``에 결과 기록 →
 * makePreview로 ≤2,048px 프리뷰를 재생성해 반환. 결과는 removeBg와 동일한
 * 에셋 치환 정책으로 캔버스에 반영된다.
 *
 * 체크포인트·재개(§5.3·§5.6): 스텝 PNG를 작업 폴더에 남기고 성공 시 파기.
 * 취소·실패 시 완료 스텝이 하나라도 있으면 단일 슬롯 재개 레지스트리에 기록해
 * 렌더러가 "마지막 완료 단계부터 재개" 버튼을 노출한다 — 재개는 체크포인트
 * step{n}.png를 시작 이미지로 나머지 스텝만 이어 실행한다(진행률 번호는 전체
 * 체인 기준 유지). 새 실행 시작 시 이전 레지스트리의 체크포인트는 파기한다.
 *
 * 예상 시간 캘리브레이션(§4.6): AI 실행 성공마다 ms/MP를 userData 파일에
 * 누적 평균으로 기록한다 — 다이얼로그의 예상 시간 표시 근거. 재개 실행은
 * 부분 구간이라 측정에서 제외한다.
 */
import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  buildUpscalePlan,
  overallProgress as weightedProgress,
  type UpscalePlanInput
} from '../../core/upscaler/plan'
import { extractImageDpi, extractImageSize } from '../../core/imageMeta'
import { makePreview, readHeaderBytes } from './imageImport'
import { cancelSidecar, upscaleViaSidecar } from './export'
import type {
  ImageInfo,
  UpscaleCalibration,
  UpscaleOptions,
  UpscaleProgress,
  UpscaleResumeInfo,
  UpscaleSidecarProgress,
  UpscaleSidecarRequest,
  UpscaledImage
} from '../../types/ipc'

const HEADER_BYTES = 262_144

/** 결과 포맷 → 확장자 */
const FORMAT_EXT: Record<UpscaleOptions['format'], string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp'
}

/** 엔진 선택 → 사이드카 모델명 (export-sidecar/upscale.py MODEL_URLS와 동기) */
const ENGINE_MODEL: Record<'general' | 'anime', string> = {
  general: 'RealESRGAN_x4',
  anime: 'RealESR-AnimeVideo-x4'
}

/** 재개 레지스트리 — 단일 슬롯(마지막 실패·취소 실행). 앱 재시작 시 소멸. */
interface ResumableRun {
  workDir: string
  filePath: string
  request: Omit<UpscaleSidecarRequest, 'resume_from_path' | 'skip_steps' | 'checkpoint_dir'>
  weights: number[]
  totalScale: number
  skipSteps: number
  totalSteps: number
}

let resumable: ResumableRun | null = null

/** 실행 공간 확보 — 새 실행이 시작되면 이전 재개 후보의 체크포인트를 파기 */
function claimNewRun(): void {
  if (resumable !== null) {
    rmSync(join(resumable.workDir, 'checkpoints'), { recursive: true, force: true })
    resumable = null
  }
}

function calibrationPath(): string {
  return join(app.getPath('userData'), 'upscale-calibration.json')
}

function readCalibration(): UpscaleCalibration {
  try {
    const parsed = JSON.parse(readFileSync(calibrationPath(), 'utf-8')) as {
      msPerMpx?: unknown
    }
    if (typeof parsed.msPerMpx === 'number' && parsed.msPerMpx > 0) {
      return { msPerMpx: parsed.msPerMpx }
    }
  } catch {
    // 파일 없음·손상 — 첫 측정까지 null
  }
  return { msPerMpx: null }
}

/** ms/MP 누적 평균 기록 — AI 신규 실행 성공 때만 호출(재개·리샘플 제외) */
function updateCalibration(durationMs: number, targetW: number, targetH: number): void {
  const mp = (targetW * targetH) / 1_000_000
  if (mp <= 0) return
  const sample = durationMs / mp
  let msPerMpx = sample
  let samples = 1
  try {
    const prev = JSON.parse(readFileSync(calibrationPath(), 'utf-8')) as {
      msPerMpx?: unknown
      samples?: unknown
    }
    if (
      typeof prev.msPerMpx === 'number' &&
      prev.msPerMpx > 0 &&
      typeof prev.samples === 'number'
    ) {
      msPerMpx = (prev.msPerMpx * prev.samples + sample) / (prev.samples + 1)
      samples = prev.samples + 1
    }
  } catch {
    // 첫 샘플
  }
  try {
    writeFileSync(calibrationPath(), JSON.stringify({ msPerMpx, samples }), 'utf-8')
  } catch (err) {
    console.error(
      `[upscale] 캘리브레이션 기록 실패(무시): ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

function readImageInfo(absPath: string): ImageInfo {
  const header = readHeaderBytes(absPath, HEADER_BYTES)
  const size = extractImageSize(header)
  if (size === null) {
    throw new Error('이미지 치수를 읽을 수 없어요 (PNG·JPG·WebP만 지원해요)')
  }
  const dpi = extractImageDpi(header)
  const bytes = statSync(absPath).size
  return { width: size.width, height: size.height, bytes, ...(dpi !== null ? { dpi } : {}) }
}

/** 렌더러 옵션 신뢰 경계 검증 — 계획 입력(단위·치수)과 실행 옵션을 분리해 반환 */
function parseOptions(raw: unknown): {
  plan: UpscalePlanInput
  exec: UpscaleOptions
  engine: 'general' | 'anime'
} {
  if (typeof raw !== 'object' || raw === null) throw new Error('업스케일 옵션이 올바르지 않습니다')
  const opt = raw as Record<string, unknown>

  const unit = opt.unit
  if (unit !== 'cm' && unit !== 'px' && unit !== 'scale') {
    throw new Error('단위는 cm·px·배율 중 하나여야 합니다')
  }
  const stepStrategy = opt.stepStrategy
  if (
    stepStrategy !== 'AUTO' &&
    stepStrategy !== 'STEP_2X' &&
    stepStrategy !== 'STEP_3X' &&
    stepStrategy !== 'STEP_5X' &&
    stepStrategy !== 'DIRECT'
  ) {
    throw new Error('처리 방식이 올바르지 않습니다')
  }
  const fitMode = opt.fitMode
  if (
    fitMode !== 'KEEP_RATIO' &&
    fitMode !== 'COVER' &&
    fitMode !== 'CONTAIN' &&
    fitMode !== 'STRETCH'
  ) {
    throw new Error('비율 처리 방식이 올바르지 않습니다')
  }
  const format = opt.format
  if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
    throw new Error('저장 포맷은 PNG·JPEG·WebP 중 하나여야 합니다')
  }
  const engine = opt.engine ?? 'general'
  if (engine !== 'general' && engine !== 'anime') {
    throw new Error('엔진은 일반·애니메이션 중 하나여야 합니다')
  }
  if (typeof opt.dpi !== 'number' || !Number.isInteger(opt.dpi) || opt.dpi < 1 || opt.dpi > 1200) {
    throw new Error('DPI는 1~1200 사이 정수로 입력해 주세요')
  }

  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined

  const plan: UpscalePlanInput = {
    unit,
    widthCm: num(opt.widthCm),
    heightCm: num(opt.heightCm),
    widthPx: num(opt.widthPx),
    heightPx: num(opt.heightPx),
    scale: num(opt.scale),
    dpi: opt.dpi,
    strategy: stepStrategy,
    fitMode
  }

  const quality = num(opt.quality) ?? 0.95
  if (quality <= 0 || quality > 1) throw new Error('품질은 0~1 사이로 입력해 주세요')
  const sharpening = num(opt.sharpening) ?? 0.3
  if (sharpening < 0 || sharpening > 1) throw new Error('샤픈 강도는 0~1 사이로 입력해 주세요')
  const denoiseLevel = opt.denoiseLevel ?? 0
  if (denoiseLevel !== 0 && denoiseLevel !== 1 && denoiseLevel !== 2) {
    throw new Error('노이즈 제거 단계는 0·1·2 중 하나여야 합니다')
  }
  const embedDpiMetadata = opt.embedDpiMetadata ?? true
  if (typeof embedDpiMetadata !== 'boolean') throw new Error('DPI 포함 여부는 참/거짓이어야 합니다')

  return {
    plan,
    engine,
    exec: {
      unit,
      widthCm: plan.widthCm,
      heightCm: plan.heightCm,
      widthPx: plan.widthPx,
      heightPx: plan.heightPx,
      scale: plan.scale,
      dpi: opt.dpi,
      stepStrategy,
      fitMode,
      format,
      quality,
      embedDpiMetadata,
      sharpening,
      denoiseLevel,
      engine
    }
  }
}

/** 와이어 진행(snake_case) → 가중 진행률 첨부된 렌더러 이벤트로 변환 (§4.5) */
function toRendererProgress(
  weights: readonly number[],
  progress: UpscaleSidecarProgress
): UpscaleProgress {
  const fraction =
    progress.stage === 'tile'
      ? progress.total > 0
        ? progress.current / progress.total
        : 0
      : progress.stage === 'encode'
        ? 1
        : progress.current
  return {
    stage: progress.stage,
    step: progress.step,
    totalSteps: progress.total_steps,
    current: progress.current,
    total: progress.total,
    overallProgress: weightedProgress(weights, progress.step - 1, fraction)
  }
}

/** 사이드카 실행 공통 본문 — 진행 중계·완료 스텝 추적·재개 등록/해제·캘리브레이션 */
async function executeUpscale(
  sender: Electron.WebContents,
  request: UpscaleSidecarRequest,
  context: {
    workDir: string
    weights: number[]
    totalScale: number
    aiUsed: boolean
    calibrate: boolean
  }
): Promise<UpscaledImage> {
  let completedSteps = 0
  try {
    const result = await upscaleViaSidecar(request, (progress) => {
      if (progress.stage === 'step' && progress.current >= 1) completedSteps = progress.step
      sender.send('upscale:progress', toRendererProgress(context.weights, progress))
    })

    // 성공 — 이 실행·남아있던 재개 후보의 체크포인트를 모두 파기 (§5.6)
    rmSync(join(context.workDir, 'checkpoints'), { recursive: true, force: true })
    if (resumable !== null && resumable.workDir !== context.workDir) {
      rmSync(join(resumable.workDir, 'checkpoints'), { recursive: true, force: true })
    }
    resumable = null
    if (context.calibrate && context.aiUsed) {
      updateCalibration(result.duration_ms, result.width_px, result.height_px)
    }
    const preview = makePreview(result.output_path)
    return {
      filePath: result.output_path,
      ...preview,
      totalScale: context.totalScale,
      steps: result.steps.map((record, index) => ({
        step: request.skip_steps + index + 1,
        scale: record.scale,
        outW: record.out_w,
        outH: record.out_h,
        ms: record.ms
      })),
      elapsedMs: result.duration_ms
    }
  } catch (err) {
    // 취소·실패 — 완료 스텝이 있으면 재개 등록, 없으면 슬롯 비움 (§5.3)
    if (completedSteps >= 1 && completedSteps < request.chain.length) {
      resumable = {
        workDir: context.workDir,
        filePath: request.input_path,
        request: {
          input_path: request.input_path,
          output_path: request.output_path,
          chain: request.chain,
          target_w: request.target_w,
          target_h: request.target_h,
          fit_mode: request.fit_mode,
          crop: request.crop,
          format: request.format,
          quality: request.quality,
          dpi: request.dpi,
          embed_dpi: request.embed_dpi,
          sharpen: request.sharpen,
          denoise: request.denoise,
          model: request.model
        },
        weights: context.weights,
        totalScale: context.totalScale,
        skipSteps: completedSteps,
        totalSteps: request.chain.length
      }
    } else {
      resumable = null
    }
    throw err
  }
}

async function runUpscale(
  sender: Electron.WebContents,
  filePath: string,
  options: unknown
): Promise<UpscaledImage> {
  const { plan: planInput, exec, engine } = parseOptions(options)
  const info = readImageInfo(filePath)
  const plan = buildUpscalePlan(planInput, { width: info.width, height: info.height })
  claimNewRun()

  const workDir = join(app.getPath('userData'), 'upscale', randomUUID())
  mkdirSync(workDir, { recursive: true })
  const outputPath = join(workDir, `result.${FORMAT_EXT[exec.format]}`)
  // 취소·실패 시 체크포인트는 디스크에 보존된다(재개 대비 §5.6) — 성공 경로에서만 파기.
  const checkpointDir = join(workDir, 'checkpoints')

  const request: UpscaleSidecarRequest = {
    input_path: filePath,
    output_path: outputPath,
    chain: plan.chain,
    target_w: plan.target.width,
    target_h: plan.target.height,
    fit_mode: plan.fitMode,
    crop: plan.srcCrop
      ? { x: plan.srcCrop.x, y: plan.srcCrop.y, w: plan.srcCrop.width, h: plan.srcCrop.height }
      : null,
    format: exec.format,
    quality: exec.quality ?? 0.95,
    dpi: planInput.dpi,
    embed_dpi: exec.embedDpiMetadata ?? true,
    sharpen: exec.sharpening ?? 0.3,
    denoise: exec.denoiseLevel ?? 0,
    model: ENGINE_MODEL[engine],
    checkpoint_dir: checkpointDir,
    resume_from_path: null,
    skip_steps: 0
  }
  return executeUpscale(sender, request, {
    workDir,
    weights: plan.weights,
    totalScale: plan.totalScale,
    aiUsed: plan.aiUsed,
    calibrate: true
  })
}

/** 재개 실행 — 레지스트리의 체크포인트 step{skip}.png에서 나머지 스텝만 실행 */
async function resumeUpscale(sender: Electron.WebContents): Promise<UpscaledImage> {
  const run = resumable
  if (run === null) throw new Error('이어서 처리할 작업이 없어요')
  const checkpoint = join(run.workDir, 'checkpoints', `step${run.skipSteps}.png`)
  if (!existsSync(checkpoint)) {
    resumable = null
    throw new Error('이어서 처리할 중간 결과가 사라졌어요 — 처음부터 다시 시도해 주세요')
  }
  const request: UpscaleSidecarRequest = {
    ...run.request,
    checkpoint_dir: join(run.workDir, 'checkpoints'),
    resume_from_path: checkpoint,
    skip_steps: run.skipSteps
  }
  return executeUpscale(sender, request, {
    workDir: run.workDir,
    weights: run.weights,
    totalScale: run.totalScale,
    aiUsed: true,
    calibrate: false
  })
}

export function registerUpscaleIpc(): void {
  ipcMain.handle('image:info', (_event, filePath: unknown): ImageInfo => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('잘못된 파일 경로 요청')
    }
    return readImageInfo(filePath)
  })

  ipcMain.handle(
    'image:upscale',
    (event, filePath: unknown, options: unknown): Promise<UpscaledImage> => {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error('잘못된 파일 경로 요청')
      }
      return runUpscale(event.sender, filePath, options)
    }
  )

  ipcMain.handle('image:upscale-resume', (event): Promise<UpscaledImage> =>
    resumeUpscale(event.sender)
  )

  ipcMain.handle('upscale:resumable', (): UpscaleResumeInfo | null => {
    const run = resumable
    if (run === null) return null
    const checkpoint = join(run.workDir, 'checkpoints', `step${run.skipSteps}.png`)
    if (!existsSync(checkpoint)) {
      resumable = null
      return null
    }
    return {
      filePath: run.filePath,
      skipSteps: run.skipSteps,
      totalSteps: run.totalSteps
    }
  })

  ipcMain.handle('upscale:calibration', (): UpscaleCalibration => readCalibration())

  ipcMain.handle('upscale:cancel', () => {
    cancelSidecar('업스케일이 취소되었습니다')
  })
}
