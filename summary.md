# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: S4 세션 1 (이미지 임포트 + 씬 배치) — 세션 1

## 현재 상태
- **S4 세션 1 완료**: 파일 대화상자 + DnD 임포트, 메인 프로세스 ≤2,048px 프리뷰(nativeImage·mtime 캐시),
  씬 배치(원본 px 그대로 렌더) + Playwright 실기동 검증 통과(12/12 × 2회 + 리사이즈 분기).
- **S1 세션 2(실규격 포토샵 수동검증) 여전히 보류** — 포토샵 설치 머신에서 6,890×13,780 PSD 개봉 체크리스트(SKILL.md §4) 확인 필요.

## 완료한 항목 (S4 세션 1)
- `src/types/ipc.ts` 신규 — 공유 IPC 계약(`ImportedImage`, `DtfApi`): 렌더러↔메인 경로만 전달, 바이너리 IPC 금지 원칙 명문화
- `src/main/ipc/imageImport.ts` 신규 + `src/main/index.ts` 등록 1줄:
  - `dialog:open-images` — 다중 선택 파일 대화상자(PNG/JPG/JPEG/WEBP/TIFF/BMP 필터), 취소 시 null
  - `image:import` — `nativeImage.createFromPath` → 원본 크기(`getSize()` 리사이즈 전) + 최대변 2,048px
    프리뷰 PNG dataURL 반환, 경로+mtime 키 Map 캐시(상한 64, 재임포트 0비용)
- `src/preload/index.ts` + `index.d.ts` — `api.openImages`·`api.importImage`·`api.getPathForFile` 노출
- `src/renderer/src/components/canvas/`:
  - `placement.ts` 신규 — 순수 함수 `screenToDoc`·`viewCenterDoc`·`centeredTopLeft`(캐스케이드 화면 24px)
    + `ViewTransform` 이동 정의, `placement.test.ts` 6개 (Vitest 선검증)
  - `useHtmlImage.ts` 신규 — dataUrl→HTMLImageElement 모듈 캐시 훅(상한 32, 캐시 히트 즉시 반환)
  - `ProxyCanvas.tsx` — `PlacedImage[]` 상태 + 배치 Layer(Image 노드 원본 px 그대로) + 오버레이 "가져오기"
    버튼 + DnD(onDrop→문서 좌표 변환 배치). 줌/팬 로직 무변경(stage scale/position만)
- `package.json`: devDependencies에 `playwright-core` 추가(브라우저 다운로드 없는 Electron E2E용, 이후 세션 재사용)
- 검증: typecheck(node+web) ✓ · lint 0경고 ✓ · vitest 16 passed ✓ · 빌드 ✓ ·
  Playwright E2E(프로덕션 빌드 + 대화상자 메인 스텁): 렌더·원본 크기·뷰 중심 배치 좌표(오차<0.01)·
  PNG dataURL·캐시 동일성·줌/팬/맞춤 무회귀·콘솔 에러 없음 = 12/12 × 2회 ·
  리사이즈 분기: 4,000×2,000 PNG(zlib 직접 생성) → 프리뷰 2,048×1,024 비율 유지 ✓

## 결정·변경 사항 (S4 세션 1)
- **Electron 44에서 `File.path`는 제거됨** → 공식 대체 `webUtils.getPathForFile(file)`를 프리로드에 노출해
  "경로만 전달" 원칙 유지 (절약 팁 #1의 구현 조정)
- `PlacedImage`가 `filePath` 보유 — S6 내보내기(풀해상도 렌더)에서 원본 소스로 사용
- 씬 상태는 현재 `ProxyCanvas` 내부 — S5 undo 커맨드 스택 도입 시 App/씬모듈로 리프트 예정
- nativeImage 디코딩은 PNG/JPG 보장 — WEBP/TIFF/BMP는 플랫폼별 실패 가능 → 사용자 안내 에러.
  sharp 도입은 실수요 발생 시 별도 결정
- 다이얼로그 E2E 자동화: 메인 프로세스 `dialog.showOpenDialog` 스텝 교체(`electronApp.evaluate`)로 회피 —
  `_electron.launch({ executablePath: require('electron'), args: [REPO] })` 패턴 (프로덕션 빌드 필요)
- Konva 검증은 `window.Konva.stages[0]` API로 확인(프로덕션 빌드에서도 전역 노출 확인됨, S3 팁 유지)

## 다음 세션
- 단계: **S4 세션 2 — 선택/해제, 드래그 이동, Del 삭제** (PLAN.md 참조)
- 사전 결정 사항: **캔버스 당 단 1개의 공유 Konva.Transformer** — 클릭된 노드 id만
  `transformer.nodes([selectedNode])`로 바인딩(이미지별 핸들러/트랜스포머 금지, 절약 팁 #3).
  Stage 빈 곳 클릭 = 해제, 이미지 드래그 = 이동(stage draggable과 충돌 시 stage.draggable 우선 로직 설계),
  Del 키 = 선택 항목 삭제. `PlacedImage` 상태 리프트는 S5까지 유지 불필요 — ProxyCanvas 내부에
  `selectedId` 상태 추가로 충분
- 핀포인트: `src/renderer/src/components/canvas/ProxyCanvas.tsx` (및 신규 interactions 컴포넌트 가능)
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S4 항목만 읽고 시작하세요.
S4 세션 2(선택/이동/Del 삭제) 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
단일 공유 Konva.Transformer 패턴을 사용하세요 (이미지별 트랜스포머 금지).
수정 대상은 src/renderer/src/components/canvas/ 내부입니다.
```
