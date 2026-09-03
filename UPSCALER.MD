# [기능 구현 지시서] 사용자 친화적 cm 기반 단계별 AI 이미지 업스케일러
## Step-by-Step AI Image Upscaler — v2.0

| 항목 | 내용 |
|---|---|
| 문서 버전 | v2.0 |
| 모듈명 | `@app/upscaler` |
| 대상 사용자 | 픽셀(px)/DPI/배율 개념이 익숙하지 않은 일반 사용자 (최우선) + 숙련자 (부차) |
| 산출물 | 업스케일 코어 엔진(순수 TS, UI 비의존) + UI 컴포넌트 |

### 변경 이력 (v1 → v2 주요 업그레이드)
1. **체인 분할 알고리즘 모호성 해소**: v1의 규칙 설명과 예제가 상충하던 문제(총 10배 + 2배 단위 시 `[2,2,2,1.25]` vs `[2,2,2.5]`)를 "잔여 배율 흡수 규칙"으로 통일 (→ 4.3)
2. **AUTO 전략 신설**: 총 배율에 따라 최적 전략을 자동 추천 (→ 4.4)
3. **가로/세로 비율 불일치 처리(FitMode) 신설**: CONTAIN / COVER / STRETCH / KEEP_RATIO (→ 4.2)
4. **취소(AbortSignal)·체크포인트·재개 지원** (→ 5.3, 5.6)
5. **진행률 픽셀 가중치 공식** 도입 — 단계마다 체감 속도가 다른 문제 해결 (→ 4.5)
6. **DPI 메타데이터 임베드**: 결과 파일이 인쇄 프로그램에서 실제 cm 크기로 인식되도록 (→ 5.5)
7. **Web Worker + OffscreenCanvas + 타일링 아키텍처** 명시 (→ 2, 5.4)
8. **입력 정규화 정의**: EXIF 회전, 알파 채널, 색공간 처리 (→ 6.3)
9. **오류 코드 체계, 성능 KPI, 테스트 계획, 마일스톤** 추가 (→ 6~10)
10. **출력물 프리셋(명함/A4 등)**, 예상 처리 시간/파일 크기 표시 등 UI 고도화 (→ 3)

---

## 1. 개발 목적 및 범위

### 1.1 목적
- 최종 출력물 크기를 **cm 단위**로 지정하고, 300DPI(인쇄) / 72DPI(웹) 프리셋으로 타겟 픽셀을 자동 계산한다.
- 대율 확대 시 화질 뭉개짐을 방지하기 위해 **단계적(프로그레시브) 업스케일 파이프라인**을 지원한다.
- 전 과정에서 **초보자가 이해할 수 있는 언어**로 상태를 안내한다. (픽셀 수치는 보조 정보로만 노출)

### 1.2 핵심 사용자 시나리오
| # | 시나리오 |
|---|---|
| S1 | "명함(9×5cm) 크기로 인쇄할 건데" → 명함 프리셋 선택 → 300DPI 자동 적용 → 원클릭 처리 |
| S2 | "블로그에 올릴 사진을 크고 선명하게" → 웹용(72DPI) 선택 → 빠른 처리 |
| S3 | 숙련자가 "정확히 4000×3000px, 5배씩 단계 처리"를 직접 지정 |

### 1.3 범위 밖 (Non-Goals)
- CMYK 색변환, 벡터화, 생성 AI(부분 재생성), 동영상 처리
- 원본보다 **작게** 만드는 다운스케일의 고도화 (단순 고품질 리샘플만 제공, → 6.2)

---

## 2. 시스템 아키텍처

```
[UI 컴포넌트]
    │  입력값 / 이벤트
    ▼
[Plan Builder (순수 함수)]        ← UI 없이 단위 테스트 가능
    │  UpscalePlan (타겟px·체인·경고·메모리 추정)
    ▼
[Progressive Executor (오케스트레이터, 메인 스레드)]
    │  Worker + OffscreenCanvas
    ├─► [AI 런타임: onnxruntime-web (WebGPU → WASM SIMD 폴백)]
    ├─► [타일러 Tile Processor] (대형 이미지 분할 처리)
    ├─► [스텝 간 후처리: 샤픈/디노이즈]
    └─► [인코더 + DPI 메타데이터 임베더]
    │
    └─► [체크포인트 저장소: IndexedDB (옵션)]
```

| 구성 요소 | 책임 | 비고 |
|---|---|---|
| Plan Builder | cm→px 변환, 체인 생성, 가드레일 검사 | **부작용 없는 순수 함수**로 분리 필수 |
| Executor | 스텝 큐 순회, 진행 이벤트 발행, 취소/재개 | UI 프레임워크 비의존 |
| Step Engine | 단일 배율 스텝 실행 (모델 추론 + 정밀 리사이즈) | Worker 내부에서 동작 |
| Encoder | 포맷 인코딩 + DPI 메타 삽입 + 파일명 생성 | |

---

## 3. UI/UX 요구사항

### 3.1 화면 구성 (와이어프레임)
```
┌───────────────────────────────┬───────────────────────────────┐
│  [원본 미리보기]                │  ① 크기 입력                   │
│   (드래그/핀치 줌 지원)          │   단위: (cm | px | 배율x)      │
│                               │   가로 [    ] 세로 [    ] 🔗비율고정│
│                               │  ② 용도 선택                   │
│                               │   (웹용 72 | 인쇄용 300 | 직접)  │
│                               │  ③ 처리 방식                   │
│                               │   (자동추천 | 2배씩 | 5배씩 | 단번에)│
│                               │  ─────────────────────────────│
│                               │  ④ 예상 정보 패널 (실시간)       │
│                               │   최종: 1181×1181px (10×10cm)  │
│                               │   총 약 10배 · 3단계 · 약 40초  │
│                               │   [⚠ 주의 메시지 영역]           │
│                               │   [ 업스케일 시작 ]             │
├───────────────────────────────┴───────────────────────────────┤
│ ▓▓▓▓▓░░░░░ 62% · 2/3단계: 2배 확대 적용 중… (남은 시간 약 20초)     │
│                                                  [취소]        │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 크기 입력 (cm 지원)
- 입력 단위 선택: **cm (기본값)** / Pixel / 배율(x)
- 가로/세로 입력 필드 + **비율 고정 토글 (기본 ON)** — 고정 시 한쪽 입력만으로 자동 연산
- cm 입력 규칙: 소수점 1자리까지, 유효 범위 0.5~200cm
- **출력물 프리셋 버튼** (cm 입력 필드 위 칩 형태):

| 프리셋 | 크기(cm) | 권장 DPI | 용도 |
|---|---|---|---|
| 명함 | 9.0 × 5.0 | 300 | 명함, 카드 |
| 엽서 | 14.8 × 10.0 | 300 | 엽서, 염서 |
| A4 | 21.0 × 29.7 | 300 | 문서, 포스터(소) |
| A3 | 29.7 × 42.0 | 300 | 포스터 |
| SNS 정사각 | 10 × 10 | 72 | 인스타그램 등 |
| 자유 입력 | — | — | 직접 입력 |

### 3.3 용도/DPI 선택
- **[웹/화면용] 72 DPI** — 블로그, SNS
- **[인쇄용] 300 DPI** — 기본 권장 (명함, 굿즈, 포스터)
- **[직접 입력]** 36~1200 DPI (72 미만 입력 시 "인쇄 시 흐릿할 수 있어요" 경고)
- 150 DPI(실내 배너/전단지) 선택 옵션 추가

### 3.4 처리 방식 (Step Strategy) 선택
| 옵션 | 설명 | 비고 |
|---|---|---|
| **자동 추천 (AUTO)** | 총 배율 기준 최적 전략 자동 선택 | **기본값** (→ 4.4) |
| 안정적인 화질 보정 (2배씩) | 단계별 2배, 인공물 최소 | 추천 |
| 빠른 화질 보정 (5배씩) | 단계 수 감소, 속도 우선 | |
| 단번에 처리 (DIRECT) | 1회 적용 | 소폭 확대에만 적합 |

- 각 옵션에 초보자용 한 줄 설명 툴팁 필수. 예: *"한 번에 크게 키우면 디테일이 뭉개질 수 있어서, 나눠서 키우면 더 선명해요."*

### 3.5 실시간 예상 정보 패널 (입력 변경 시 ≤ 100ms 갱신)
- 최종 픽셀 해상도: `1181 × 1181 px`
- 총 업스케일 배율: `원본 대비 약 10배`
- 진행 단계: `2배 → 2배 → 2.5배 (총 3단계)`
- **예상 처리 시간 / 예상 파일 크기** (→ 4.6)
- **역산 정보**: `원본(400×300px)은 300DPI 기준 약 3.4×2.5cm` — 초보자의 기준점 제공

### 3.6 진행 화면
- 픽셀 가중치 기반 진행률 바 (→ 4.5) + 단계별 상세 문구:
  - `전체 10배 확대를 3단계로 진행합니다 (2배 → 2배 → 2.5배)`
  - `2/3단계: 2배 확대 적용 중… (남은 시간 약 20초)`
- **취소 버튼**: 클릭 시 "지금까지 완료된 단계 결과를 저장할까요?" 확인 후 체크포인트 보존

### 3.7 결과 화면
- Before/After 드래그 슬라이더 비교 + 확대 렌즈
- 출력 옵션: 포맷(PNG/JPEG/WebP), 품질 슬라이더(JPEG/WebP), 파일명 패턴
  - 기본 패턴: `{name}_upscaled_{w}x{h}.png` / 토큰: `{name},{scale},{w},{h},{dpi},{date}`
- 완료 안내: `300DPI 정보가 포함되어 인쇄 프로그램에서 9×5cm로 인식됩니다`
- 다시 처리(설정 유지) / 원본·결과 동시 다운로드

### 3.8 초보자 보조 장치
- 모든 전문 용어에 툴팁 + 부록 A 용어 사진 링크
- 숫자 입력 오류 시 즉시 인라인 검증 (`0.5~200cm 사이로 입력해 주세요`)
- 상태를 **아이콘 + 텍스트**로 병기 (색상만으로 구분 금지)

---

## 4. 핵심 계산 로직 (Plan Builder)

### 4.1 cm → Pixel → 총 배율
```
TargetPixelW = round(Width_cm  / 2.54 × DPI)
TargetPixelH = round(Height_cm / 2.54 × DPI)
TotalScale S = TargetPixelW / SrcPixelW   (소수점 2자리)
```
- 단위가 px이면 타겟 px 직접 사용, 배율(x)이면 `TargetPixel = round(SrcPixel × S)`
- 비율 고정 ON 시, 입력된 한쪽 축 기준으로 다른 축 자동 계산

### 4.2 가로/세로 비율 불일치 처리 (신설)
```
scaleX ≠ scaleY 이고 차이가 3% 초과 → WARN_RATIO_MISMATCH 발생 후 사용자 선택:
  KEEP_RATIO (기본·권장): 목표를 원본 비율에 맞게 재조정 (인쇄 여백 안내 표시)
  COVER: 목표 비율로 원본 센터 크롭 후 업스케일
  CONTAIN: 목표 캔버스에 맞추고 여백(투명) 추가
  STRETCH: 비균등 리사이즈 (왜곡 감수, 경고 표시)
```

### 4.3 스텝 체인 분할 알고리즘 (캐노니컬)
> v1의 규칙 설명(잔여 ≤ K)과 예제(`[2,2,2.5]`)의 상충을 아래 규칙으로 통일한다.

**규칙**
1. `K` = 전략 단위 (STEP_2X: 2, STEP_3X: 3, STEP_5X: 5)
2. 잔여 배율이 K보다 큰 동안 K배 스텝을 추가하고 잔여를 K로 나눈다.
3. 마지막 잔여를 마지막 스텝으로 추가한다.
4. **잔여 흡수 규칙**: 마지막 스텝이 1.5배 미만이면 "무의미한 마이크로 스텝"이므로 이전 스텝에 흡수한다. 단, 흡수 후 한 스텝이 `K × 1.25`를 초과하면 흡수를 취소한다.

```ts
export function buildStepChain(totalScale: number, strategy: StepStrategy): number[] {
  if (strategy === 'DIRECT' || totalScale <= 1) return [round2(totalScale)];

  const K = STEP_SIZE[strategy];            // 2 | 3 | 5
  const ABSORB_THRESHOLD = 1.5;
  const CAP = K * 1.25;

  const steps: number[] = [];
  let r = totalScale;
  while (r > K) { steps.push(K); r /= K; }
  steps.push(r);

  const last = steps[steps.length - 1];
  if (steps.length >= 2 && last < ABSORB_THRESHOLD) {
    const merged = round2(steps[steps.length - 2] * last);
    if (merged <= CAP * 1.001) steps.splice(-2, 2, merged);
  }
  return steps;
}
```

**검증표 (단위 테스트 기대값)**
| 총 배율 S | 전략 | 생성 체인 | 단계 수 |
|---|---|---|---|
| 10 | 2배씩 | `[2, 2, 2.5]` | 3 |
| 10 | 5배씩 | `[5, 2]` | 2 |
| 8 | 2배씩 | `[2, 2, 2]` | 3 |
| 5 | 2배씩 | `[2, 2.5]` | 2 |
| 3 | 2배씩 | `[2, 1.5]` | 2 |
| 26 | 5배씩 | `[5, 5.2]` | 2 |
| 1.2 | AUTO | `[1.2]` (AI 생략) | 1 |
| 0.5 | 모두 | `[0.5]` + 다운스케일 경고 | 1 |

### 4.4 AUTO 전략 규칙 (신설)
| 총 배율 S | 선택 | 근거 |
|---|---|---|
| S ≤ 1.5 | DIRECT | AI 효과 미미, 고품질 리샘플로 충분 |
| 1.5 < S ≤ 12 | STEP_2X | 인공물 누적 최소화 |
| S > 12 | STEP_2X + 타일링 강제 + 메모리 경고 | 초대형 출력 대응 |

### 4.5 진행률 픽셀 가중치 (신설)
스텝의 연산량은 출력 면적에 비례하므로 가중치를 `누적 배율²`로 부여한다.
```
weight_i = (S₁×…×Sᵢ)²
overall  = (Σ 완료된 weight + 현재 weight × 스텝 내부 진행률) / Σ 전체 weight
```
- 예: `[2, 2, 2.5]` → 기여도 3.3% / 13.3% / 83.3% → "마지막 단계가 가장 오래 걸린다"를 사전 안내
- 진행 이벤트는 **최소 4회/초** 발행 (멈춤 오인 방지)

### 4.6 메모리·시간 추정 (신설)
```
estMemoryMb = TargetW × TargetH × 4Byte(RGBA) × 2.5(오버헤드) / 1MB
estTimeMs   = 최근 처리 실적 기반 mpv초당 계수 × TargetMP (런타임 캘리브레이션)
```
- 예: 8000×600px 목표 → 약 480MB 추정

---

## 5. 모듈 및 API 인터페이스 설계

### 5.1 타입 정의
```ts
export type Unit = 'cm' | 'px' | 'scale';
export type StepStrategy = 'AUTO' | 'STEP_2X' | 'STEP_3X' | 'STEP_5X' | 'DIRECT';
export type FitMode = 'KEEP_RATIO' | 'COVER' | 'CONTAIN' | 'STRETCH';
export type OutputFormat = 'png' | 'jpeg' | 'webp';
export type EngineId = 'realesrgan-x4plus' | 'realesrgan-x4-anime' | 'realesr-general-x4v3';

export interface UpscaleRequest {
  imageFile: File | Blob;
  unit: Unit;
  targetWidthCm?: number;
  targetHeightCm?: number;
  targetWidthPx?: number;
  targetHeightPx?: number;
  targetScale?: number;
  dpi: number;                          // 72 | 150 | 300 | 600 | 커스텀
  stepStrategy: StepStrategy;
  fitMode: FitMode;
  output: {
    format: OutputFormat;
    quality?: number;                   // 0~1 (jpeg/webp)
    embedDpiMetadata: boolean;          // 기본 true
    filenamePattern?: string;
  };
  processing: {
    engine?: EngineId;
    sharpening?: number;                // 0~1, 스텝 간 샤픈 강도 (기본 0.3)
    denoiseLevel?: 0 | 1 | 2;
    tiling?: { tileSize: 256 | 512; overlap: 16 | 32 } | 'auto';
    maxTargetPx?: number;               // 기본 8000
    maxMemoryMb?: number;               // 기본 2048
  };
  checkpoint?: { enabled: boolean; storage: 'memory' | 'indexeddb' };
  signal?: AbortSignal;                 // 취소 지원
}

export interface UpscalePlan {
  src: { width: number; height: number };
  target: { width: number; height: number };
  totalScale: number;
  chain: number[];                      // 예: [2, 2, 2.5]
  fitMode: FitMode;
  warnings: WarningCode[];
  estimatedMemoryMb: number;
  estimatedTimeMs?: number;
}

export type UpscaleEvent =
  | { type: 'START'; plan: UpscalePlan }
  | { type: 'STEP_START'; step: number; totalSteps: number; stepScale: number; message: string }
  | { type: 'STEP_PROGRESS'; overallProgress: number; etaMs?: number }
  | { type: 'STEP_DONE'; step: number; currentPx: { width: number; height: number }; previewUrl?: string }
  | { type: 'WARNING'; code: WarningCode; message: string }
  | { type: 'DONE' } | { type: 'CANCELLED' }
  | { type: 'ERROR'; code: ErrorCode; message: string };

export interface UpscaleResult {
  blob: Blob;
  width: number; height: number;
  dpi: number;
  totalScale: number;
  steps: { step: number; scale: number; outPx: { width: number; height: number }; ms: number }[];
  elapsedMs: number;
  peakMemoryMb: number;
}

export declare function buildUpscalePlan(req: UpscaleRequest, src: { width: number; height: number }): UpscalePlan;

export declare function executeProgressiveUpscale(
  req: UpscaleRequest,
  onEvent: (e: UpscaleEvent) => void
): Promise<UpscaleResult>;
```

### 5.2 Progressive Executor 구현 스켈레톤
```ts
export async function executeProgressiveUpscale(
  req: UpscaleRequest,
  onEvent: (e: UpscaleEvent) => void
): Promise<UpscaleResult> {
  const src = await loadAndNormalize(req.imageFile);   // EXIF 회전·sRGB·알파 보존 (→ 6.3)
  const plan = buildUpscalePlan(req, src);
  emitGuardrailWarnings(plan, onEvent);                // 경고/자동 조정 안내
  onEvent({ type: 'START', plan });

  let current = src.bitmap;
  const chain = plan.chain;
  const weights = cumulativeSquareWeights(chain);      // → 4.5
  const records: UpscaleResult['steps'] = [];
  const t0 = performance.now();

  for (let i = 0; i < chain.length; i++) {
    assertNotAborted(req.signal);                      // ERR_CANCELLED
    onEvent({ type: 'STEP_START', step: i + 1, totalSteps: chain.length,
              stepScale: chain[i], message: stepMessage(i, chain) });

    const prev = current;
    current = await upscaleOneStep(current, chain[i], { // Worker 내 실행
      engine: req.processing.engine,
      tiling: resolveTiling(current, req.processing.tiling),
      signal: req.signal,
      onTick: (f) => onEvent({
        type: 'STEP_PROGRESS',
        overallProgress: overallProgress(weights, i, f),
        etaMs: estimateEta(weights, i, f, records),
      }),
    });
    current = req.processing.sharpening
      ? await sharpen(current, req.processing.sharpening) : current;

    records.push({ step: i + 1, scale: chain[i],
                   outPx: sizeOf(current), ms: /* 측정값 */ });
    if (req.checkpoint?.enabled) await saveCheckpoint(i, current);
    releaseBitmap(prev);                               // 메모리 즉시 해제
    onEvent({ type: 'STEP_DONE', step: i + 1,
              currentPx: sizeOf(current), previewUrl: await makePreview(current) });
  }

  const blob = await encodeWithDpi(current, req.output, req.dpi);
  onEvent({ type: 'DONE' });
  return { blob, width: sizeOf(current).width, height: sizeOf(current).height,
           dpi: req.dpi, totalScale: plan.totalScale, steps: records,
           elapsedMs: performance.now() - t0, peakMemoryMb: peakTracker.read() };
}
```

### 5.3 취소 / 재개 정책
- 취소: `AbortSignal` 감지 시 **스텝 경계 또는 타일 경계**에서 안전 중단 (≤ 1초)
- 스텝 실패: 자동 1회 재시도 → 실패 시 체크포인트가 있으면 "마지막 완료 단계부터 재개" 버튼 제공

### 5.4 타일링 (대형 이미지)
- 임계값: 한 스텝 출력이 `4096×4096` 초과 시 타일링 강제
- 타일 256/512px, 오버랩 16/32px, 경계는 알파 블렌딩으로 이음새 제거
- 진행률: 타일 완료 수를 스텝 내부 진행률에 반영

### 5.5 인코딩 및 DPI 메타데이터
- PNG: `pHYs` 청크 = `round(dpi / 0.0254)` px/m
- JPEG: JFIF 밀도 필드에 DPI 기록
- 안내 문구: *"DPI 정보는 인쇄 프로그램의 '실제 크기' 인식용이며, 픽셀 수는 변하지 않습니다."*

### 5.6 체크포인트
- 스텝 완료 시마다 중간 결과 저장 (memory: 기본 / indexeddb: 대형 이미지)
- 키: `upscale:{fileHash}:{planHash}:step{n}`, 성공 후 자동 파기 (수동 삭제 UI 제공)

---

## 6. 예외 처리 및 안전장치

### 6.1 가드레일 (처리 전 검사)
| 조건 | 동작 |
|---|---|
| 목표 px > maxTargetPx (8000) | 모달 경고 + **[최대 크기로 자동 조정] / [직접 수정]** 선택 |
| estMemoryMb > maxMemoryMb | 타일링 강제 + 경고, 해소 불가 시 ERR_MEMORY_EXCEEDED |
| 총 배율 S < 1 | "원본보다 작은 크기예요" → AI 생략, 고품질 리새플로 처리 + 안내 |
| 1 ≤ S < 1.5 | "약간만 키우는 건 단번에 처리가 더 깔끔해요" → DIRECT 자동 전환 안내 |
| 커스텀 DPI < 72 | 인쇄 품질 경고 (진행은 허용) |

### 6.2 오류 코드 체계
| 코드 | 상황 | 사용자 메시지(예) | 복구 액션 |
|---|---|---|---|
| ERR_INVALID_FILE | 파일 아님/손상 | "이미지 파일을 확인해 주세요" | 재선택 |
| ERR_UNSUPPORTED_FORMAT | GIF/SVG/HEIC 미지원 | "JPG·PNG·WebP 파일만 지원해요" | 변환 안내 |
| ERR_INPUT_TOO_LARGE | 입력 > 50MB | "파일이 너무 커요" | 축소 안내 |
| ERR_TARGET_TOO_LARGE | 가드레일 초과·거부 | "크기를 줄여야 진행할 수 있어요" | 수정 |
| ERR_MEMORY_EXCEEDED | 메모리 한도 초과 | "크기가 너무 커서 처리할 수 없어요" | 목표 축소 제안 |
| ERR_MODEL_LOAD_FAILED | 모델 로드 실패 | "엔진 초기화에 실패했어요" | 재시도 |
| ERR_STEP_FAILED | 스텝 추론 실패 | 자동 재시도 후 안내 | 체크포인트 재개 |
| ERR_ENCODE_FAILED | 인코딩 실패 | "저장 형식을 바꿔 시도해 주세요" | 포맷 변경 |
| ERR_TIMEOUT | 스텝당 상한(기본 5분) 초과 | "시간이 너무 오래 걸려요" | 타일/축소 제안 |
| (CANCELLED) | 사용자 취소 | 오류 아님 — 별도 상태로 처리 | 저장 여부 확인 |

### 6.3 입력 정규화 (처리 전 필수)
- **EXIF Orientation 적용** (회전된 스마트폰 사진 대응)
- **알파 채널 보존** (투명 PNG), 16bit → 8bit 변환 시 경고
- 색공간: sRGB로 표준화, CMYK JPEG는 변환 시도 → 실패 시 명확한 오류 안내
- 프라이버시: 처리 시 **EXIF 위치정보 제거**, 결과 파일에 원본 EXIF 미포함(기본)

### 6.4 메모리 해제 규칙 (필수 준수)
- 스텝 종료 시 이전 `ImageBitmap.close()` 즉시 호출
- 미리보기 `URL.revokeObjectURL()` 스텝 교체 시 증발
- 취소/오류 시 Worker 종료 및 임시 캔버스·체크포인트 정리
- 검증: 연속 10회 처리 후 heap 증가 ≤ 10% (→ 7. KPI)

---

## 7. 성능·품질 요구사항 (KPI)

| 항목 | 목표 |
|---|---|
| 프리셋/입력 변경 → 예상 정보 갱신 | ≤ 100ms |
| 진행 이벤트 빈도 | ≥ 4회/초 |
| 참조 처리 시간 (1000×1000 → 2배) | WebGPU ≤ 10초 / WASM SIMD ≤ 60초 (M1급 참고치) |
| 취소 응답 시간 | ≤ 1초 |
| 메모리 피크 | 설정 한도(기본 2048MB) 이내 |
| 반복 안정성 | 10연속 처리 heap 증가 ≤ 10% |
| 품질 (표준 이미지셋, 2배) | 바이리터 대비 PSNR ≥ +3dB |
| 브라우저 | Chrome/Edge/Safari/Firefox 최신 2개 버전 |

---

## 8. 접근성 · 국제화
- 스크린리더: 진행 상황 `aria-live="polite"` 안내, 모든 입력에 라벨 연결
- 키보드 완전 조작 (모달 포커스 트랩), 명도 대비 4.5:1, `prefers-reduced-motion` 대응
- 모든 문구는 i18n 키로 분리 (기본 ko, en 확장 대비), 숫자/단위는 `Intl` 포맷 사용

---

## 9. 테스트 계획
| 레벨 | 대상 | 주요 케이스 |
|---|---|---|
| 단위 (Plan Builder) | 변환·체인·가드 | 4.3 검증표 전체, 10cm/300dpi=1181px, 비율 불일치 5%, 목표 10000px→8000 조정, S=0.5 경고 |
| 단위 (진행률) | 가중치 | `[2,2,2.5]` 진행률 단조 증가·종료 시 1.0 도달 |
| 통합 | Executor | 더미 엔진 주입 → 스텝 순서·입출력 전달·취소·메모리 해제 검증 |
| E2E | 실제 이미지 | EXIF 회전 JPEG, 투명 PNG, 50MP 대형, 2단계 중 취소 후 재개 |
| 골든 이미지 | 품질 회귀 | 승인 레퍼런스 대비 SSIM ≥ 0.98 (엔진 버전 고정) |

---

## 10. 마일스톤
| 단계 | 범위 | 완료 기준 |
|---|---|---|
| M1 | Plan Builder (순수 함수) + 단위 테스트 | 4.3 검증표 100% 통과 |
| M2 | 단일 스텝 엔진 연동 (Worker/ORT-Web) | 2배 처리 E2E 성공 |
| M3 | 프로그레시브 체인 + UI 전체 흐름 | 시나리오 S1~S3 수동 통과 |
| M4 | 취소·체크포인트·타일링·DPI 메타 | 6장 가드레일 전 항목 동작 |
| M5 | QA·성능 최적화·문서화 | KPI 표 충족 |

---

## 부록 A. 초보자 용어 사전 (UI 툴팁용)
- **픽셀(px)**: 이미지를 이루는 가장 작은 점. 숫자가 클수록 크고 선명한 이미지
- **DPI**: 1인치(2.54cm)에 들어가는 점의 수. 인쇄는 보통 300, 화면은 72
- **배율**: 원본 대비 몇 배 크게 만드는지
- **왜 cm으로 입력하나요?**: 인쇄물은 "실제 크기"가 정해져 있어서, cm과 용도만 알면 필요한 픽셀 수를 컴퓨터가 계산해 줍니다

## 부록 B. 기본 진행 메시지 문구집
| 시점 | 문구 |
|---|---|
| 시작 | "전체 {S}배 확대를 {N}단계로 진행합니다 ({체인 요약})" |
| 스텝 진행 | "{i}/{N}단계: {k}배 확대 적용 중… (남은 시간 약 {t}초)" |
| 경고(크기) | "목표 크기가 커요. 최대 크기로 조정할까요? (아니요 = 직접 수정)" |
| 완료 | "완료! {w}×{h}px · 300DPI 정보 포함 ({cm}cm 크기로 인식됩니다)" |
