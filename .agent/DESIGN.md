# DESIGN.md — 시스템 설계 및 UI/UX 아키텍처 명세서

본 문서는 **DTF GangSheet Studio**의 내부 아키텍처, 데이터 흐름, 렌더링 전략, PSD 내보내기
엔진의 상세 설계서입니다.

---

## 1. 시스템 요구사항 명세 (System Requirements)

### 1.1 문서 스펙 (Document Specifications)
- **가로 폭 (Width)**: 50 cm 고정 (350 DPI 기준 **6,890 Pixel**)
- **세로 높이 (Height)**: 1m(100cm) 단위 선택 — 지원 값은 아래 두 개뿐
  - 1m = 100cm → **13,780 Pixel**
  - 2m = 200cm → **27,559 Pixel**
  > ⚠️ **3m(41,339px) 이상은 PSD 표준 최대 치수(변당 30,000px) 초과로 저장 불가.**
  > 업체가 3m 이상을 요구하면 2m 문서로 분할한다. (PSB 전환은 업체 호환 불확실로 기각)
- **해상도 (Resolution)**: **350 DPI**
- **색상 모드 (Color Mode)**: **CMYK, 8-bit per channel** (PSD Color Mode Index `4`)
- **출력 포맷**: **.PSD** (레이어 보존 / 병합 옵션), **.PNG**(알파 보존 검수용)

### 1.2 기능 요구사항 (v1)

| ID | 요구사항 |
|---|---|
| F1 | 문서 생성: 폭 50cm 고정, 높이 1m/2m 선택, CMYK·350DPI 프리셋 자동 적용 |
| F2 | 이미지 가져오기: PNG·JPG·WEBP·TIFF·BMP — 파일 대화상자 + 드래그 앤 드롭 |
| F3 | 배치: 자유 이동 (드래그) |
| F4 | 크기 조절(고정/자유 비율) 및 회전(90°/1° 단위) |
| F5 | 복제: 단일 복제(Ctrl+D) 및 그리드 복제(행×열, 간격 지정) |
| F6 | 화면 채우기: cover(꽉 채움) / contain(맞춤) 즉시 스케일 |
| F7 | 정렬·스냅: 그리드 스냅, 간격 정렬, 여백 자동 계산 |
| F8 | PSD 내보내기: CMYK·350DPI, 레이어 보존 또는 병합 옵션 |
| F9 | PNG 검수 내보내기: 알파 보존 |
| S1 | 보조: 삭제(Del), 실행취소/다시실행(Ctrl+Z/Y), 줌(휠)·팬(스페이스 드래그) |
| S2 | 프로젝트 파일(.gsj, JSON) 저장/열기 — 편집 재개용 |

### 1.3 비기능 요구사항

| ID | 요구사항 |
|---|---|
| N1 | Windows 10/11, 오프라인 동작 (Photoshop 불필요) |
| N2 | 8GB RAM 머신에서 2m(6,890×27,559) 문서 편집·저장 가능 |
| N3 | 결과 PSD는 Photoshop CS6 이상에서 손상 경고 없이 열림 |
| N4 | 설치형 실행 파일(exe) 배포 |

### 1.4 명시적 범위 외 (v2+)
- ~~AI 배경 제거(누끼)~~ — v2 구현 완료(§8)

---

## 2. 아키텍처

### 2.1 전체 구조 (하이브리드 — 확정)

```
[Electron Renderer]  React + Konva.js — 프록시 캔버스(72~96DPI) 편집, 스냅·정렬
        │ IPC
[Electron Main]      문서 모델, 프로젝트 I/O(.gsj), 원본 에셋 디스크 관리
        │ child_process (stdio JSON-RPC)
[Python Sidecar]     내보내기: 풀해상도 렌더 → ImageCms CMYK 변환 → psd-tools PSD/PNG 기록
```

### 2.2 기술 선택 근거 (검증된 사실 기반)

| 선택지 | 판정 | 근거 |
|---|---|---|
| Electron + React + Konva (에디터) | ✅ 채택 | 웹 캔버스 생태계 성숙, Dev Container/Codespaces 호환(CLOUD) |
| `ag-psd` — CMYK PSD 쓰기 | ❌ | 공식 README: "Does not support writing any color modes other than RGB" |
| `psd-tools` — CMYK PSD 쓰기 | ✅ | `PSDImage.new('CMYK')` + `create_pixel_layer()` + `save()` 공식 지원(실험적) → M0 스파이크에서 실증 |
| Photoshop COM 자동화 | 폴백 | 색 충실도 완벽. 단 Photoshop 설치 필수(N1 위반) — M0 실패 시 대안 |

### 2.3 대안 아키텍처: PySide6 단일 파이썬 앱
사이드카 2-런타임 배포가 부담이면 PySide6(QGraphicsView) 단일 프로세스로 에디터+내보내기를
모두 파이썬으로 구성. 배포는 단순해지나 웹 캔버스 대비 인터랙션 구현 비용이 높다.

### 2.4 크로스 개발 아키텍처 (School & Home Sync)
환경 동기화·에셋 클라우드·Dev Container 규격은 `CLOUD.md`로 위임한다.
본 설계가 강제하는 것: 경로 독립성(`path.resolve`/`pathlib`)과 환경변수 기반 설정(`.env`)뿐.

---

## 3. 프록시 렌더링 및 메모리 전략

- 풀해상도 RGB 비트맵: 1m 문서 약 285MB, 2m 문서 약 570MB — **메모리 상주 금지**.
- 뷰포트: **96 DPI 프록시 캔버스**(50cm → 약 1,890px 폭)로 모든 편집 조작 수행.
- 이미지별 프리뷰: 최대 변 2,048px로 캐시, 원본은 디스크 보관.
- 줌 인 시: 보이는 타일만 고배율 프리뷰를 재생성(타일 캐시).
- 내보내기: 사이드카가 레이어 바운딩 박스 단위로만 원본을 로드·렌더(스트리밍 처리).

---

## 4. 데이터 모델 (TypeScript 초안)

```typescript
interface DocumentConfig {
  widthPx: 6890;
  heightPx: 13780 | 27559;   // 1m | 2m — 3m 이상 금지(PSD 30,000px 한계)
  dpi: 350;
  colorMode: 'cmyk';
}

interface CanvasObject {
  id: string;
  assetId: string;
  xPx: number;               // 문서 좌표(좌상단 원점), 음수 허용(캔버스 밖)
  yPx: number;
  widthPx: number;           // 배치 크기(원본 × scale)
  heightPx: number;
  rotationDeg: number;       // 90°/1°
  z: number;                 // 레이어 순서
  name: string;
}

interface ExportJob {
  document: DocumentConfig;
  objects: CanvasObject[];
  assets: Array<{ id: string; sourcePath: string }>;   // 상대 경로만
  psdOptions: { layers: 'preserve' | 'flatten'; iccProfile: string };
}
```

`.gsj` 프로젝트 파일은 `ExportJob` + 실행취소 히스토리 제외한 문서 상태의 JSON 직렬화.

---

## 5. PSD 내보내기 파이프라인 (Python 사이드카)

```
[1] 렌더    객체별 원본 로드 → 회전·스케일 반영 RGBA 렌더
            (캔버스 밖 픽셀 포함, 음수 좌표 그대로 기록)
[2] 색 변환 ImageCms.profileToProfile(sRGB → CMYK ICC: FOGRA39 등)
            (폴백: 수식 변환 — 색 오차 있음, 검수 후 사용)
[3] PSD     PSDImage.new('CMYK', (6890, H), depth=8)
            각 객체 → create_pixel_layer(cmyk_img, top, left, name)
            알파 → 픽셀 마스크(USER_LAYER_MASK)로 자동 저장
            ResolutionInfo(ID 1005)에 350 DPI 기록 → save()
            (병합 옵션: PSDImage.frompil() 단일 레이어)
[4] PNG     검수용 RGBA PNG 별도 출력
[5] 검증    Photoshop 개봉 확인(SKILL.md §4) — M0에서 자동화 스크립트 작성
```

설계 노트:
- 압축: `Compression.RLE` 기본. CMYK+RLE 호환성·파일 크기는 M0에서 ZIP과 비교해 결정.
- 예상 파일 크기: 1m 문서 CMYK 미압축 기준 약 380MB+ (합성 포함) — 압축 필수.
- PSD의 DPI는 헤더가 아닌 이미지 리소스에 기록됨 — 픽셀 크기가 진실.

---

## 6. 리스크 및 스파이크

| ID | 리스크 | 대응 |
|---|---|---|
| R1 | psd-tools 레이어 생성 API가 '실험적' — 대형 CMYK 문서에서 파손 가능 | **M0 스파이크 게이트**: 6,890×13,780 CMYK 3레이어(+캔버스 밖 확장 레이어) PSD를 Photoshop으로 검증. 실패 시 폴백: (a) Photoshop COM (b) `frompil()` 병합 CMYK PSD(레이어 미보존, 최후) |
| R2 | 거대 문서 메모리(190MP CMYK ≈ 760MB/레이어) | §3 프록시/원본 분리, 바운딩 박스 렌더, 64비트 프로세스 |
| R3 | ICC 프로파일 라이선스·색 충실도 | 번들 프로파일 라이선스 검수(FOGRA39/Japan Color), Photoshop 변환 결과와 비교 |
| R4 | 2-런타임(Node+Python) 배포 복잡도 | PyInstaller onefile로 사이드카 번들 → electron-builder 리소스 포함 |
| R5 | 업체의 3m+ 요구 | PSD 한계 안내 후 2m 분할 플로우 제공(프리셋 고정) |

---

## 7. 마일스톤

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| M0 | PSD 쓰기 스파이크 — 사이드카 단독 스크립트로 CMYK 350DPI 3레이어 PSD 생성 | Photoshop 개봉: CMYK/350DPI/크기/레이어 확인 + 소형 자동 테스트 통과 |
| M1 | Electron 골격 — 문서 생성 다이얼로그 + 프록시 캔버스(줌/팬) | 1m/2m 문서 탐색 가능 |
| M2 | 편집 완성 — 임포트·이동·크기·회전·복제·그리드 복제·화면 채우기·스냅·undo | F2~F7, S1 충족 |
| M3 | 내보내기 — IPC 연결·전체 파이프라인·진행 UI | F8, F9 충족 + SKILL §4 통과 |
| M4 | 패키징 — electron-builder + PyInstaller exe | 클린 머신에서 N1~N4 충족 |

> **M0 통과 전에는 에디터 UI 개발을 시작하지 않는다.**

---

## 8. v2 기능: 배경 제거 (구현 — .agent/REMOVEBG.MD 스펙 기반)

> 2026-09-02 v2 세션에서 구현 완료. 스펙 대비 조정 사항은 하단 표 참조.

- **엔진**: `rembg` 2.0.81(onnxruntime CPU) 로컬 추론 — 오프라인(N1) 충족.
  - 기본 모델 `birefnet-general`(SOTA 경계 정밀도), 폴백 `u2netp`/`isnet-general-use`.
  - 모델 가중치는 `U2NET_HOME`(Electron이 `userData/models`로 지정)에 첫 사용 시
    다운로드 후 캐싱 — 번들 미포함(인스톨러 1GB+ 증가 회피), 이후 오프라인 동작.
- **파이프라인** (`export-sidecar/removebg.py`):
  `remove()`(alpha_matting: fg 240 / bg 10 / erode 10 — 스펙값) →
  `apply_dtf_defringe()`(cv2 타원 커널 알파 1px 침식, JPG 흰색 테두리 제거) →
  32-bit RGBA PNG. 세션은 모델명별 1회 생성 캐싱, 처리 후 `gc.collect()`.
- **IPC**: JSON-RPC 메서드 `remove_bg` — `{input_path, output_path, model?,
  defringe_px?}` → 메타데이터 응답. **경로 기반 계약**(STDIO_GUIDE — stdio로
  바이너리·Base64 전송 금지). 스펙의 Base64 스트림은 이 규칙에 위배되어 조정됨.
- **통합 지점**: 임포트 전 자동 전처리가 아닌 **선택 항목 변환**(속성 패널
  "배경 제거" 버튼) — 원본 유지 상태에서 사용자가 변환을 선택.
  처리 결과는 알파가 포함된 RGBA PNG로 **에셋을 치환**한다(당초 "마스크를
  CanvasObject에 부착" 안은 폐기 — 내보내기 파이프라인 §5의 알파→픽셀 마스크
  경로를 그대로 재사용하며, undo 스냅샷(filePath·dataUrl 포함)으로 되돌리기 가능).
  처리 파일은 `userData/removebg/<uuid>.png`에 영구 보관(.gsj 참조).
- **UI**: PropertiesPanel "배경 제거" 섹션 — 처리 중 spinner 잠금,
  첫 사용 모델 다운로드(약 1GB) 안내 문구 포함.

### 스펙(REMOVEBG.MD) 대비 조정 요약

| 스펙 | 구현 | 근거 |
|---|---|---|
| 이미지 Base64 IPC 수신 | 경로 기반 `{input_path, output_path}` | STDIO_GUIDE 철칙(stdio 바이너리 금지) |
| 앱 시작 시 세션 생성 | 첫 `remove_bg` 요청 시 lazy 생성 | export 스폰 비용 불변(모델 ~1GB 로딩) |
| PyInstaller 번들에 모델 포함 | 첫 사용 시 U2NET_HOME 다운로드 | 인스톨러 용량(1GB+) 회피, 오프라인 N1은 캐싱으로 충족 |
| 알파 마스크 부착(DESIGN §8 초안) | RGBA PNG 에셋 치환 | 스펙이 RGBA PNG 반환, 기존 내보내기 경로 무수정 재사용 |
