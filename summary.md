# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: S5 세션 3 (화면 채우기·undo/redo) — **S5 단계 전체 완료**

## 현재 상태
- **S5 단계 완료** (세션 1 리사이즈·회전 / 세션 2 복제·그리드 / 세션 3 화면 채우기·undo/redo).
  세션 3: `fitToCanvas` cover/contain + `PlacedImage[]` JSON 스냅샷 undo/redo 스택(상한 100) —
  Vitest 33 passed · Playwright 실기동 검증 14/14 × 2회 통과.
  다음은 **S6 세션 1(내보내기 파이프라인 — stdio JSON-RPC 사이드카 서버 + 풀해상도 렌더러)**.
- **S1 세션 2(실규격 포토샵 수동검증) 여전히 보류** — 포토샵 설치 머신에서 6,890×13,780 PSD 개봉 체크리스트(SKILL.md §4) 확인 필요.

## 완료한 항목 (S5 세션 3)
- 수정 파일: `src/renderer/src/components/canvas/` 내부 3개 —
  `placement.ts`(fitToCanvas + FitMode/FitSource)·`placement.test.ts`(+6 테스트)·`ProxyCanvas.tsx`
  (히스토리 상태·commitImages·키보드 이펙트 통합·오버레이 버튼 4개) — UI 로직 외 신규 파일 없음
- **배치 수학 선검증(Vitest 33 passed)**: `fitToCanvas(item, docW, docH, mode)` — 회전 바운딩 박스
  (`|w·cosθ|+|h·sinθ|` × `|w·sinθ|+|h·cosθ|`) 기준 스케일 k(cover=max, contain=min), 치수 w·k/h·k
  비율 유지, 회전각 보존, 중심 정렬은 Konva 원점 회전 보정식 `x = cx − (cosθ·w'−sinθ·h')/2` 등으로 처리.
  코너 4개 매핑 bbox 헬퍼로 0°/90°/±임의각·극단 비율 불변식(피복/수납/중심/비율) 검증
- **Undo/Redo**: `history = {past, future}` PlacedImage[][] 상태 + `commitImages(updater)` 래퍼로
  setImages 전 경로(임포트·이동·트랜스폼·삭제·복제·그리드·R회전·채우기) 통합 — 변경 전 스냅샷 push
  (slice(-100) 상한), 새 커밋 시 future 폐기. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (+오버레이 버튼, 비활성 전이).
  undo/redo는 선택 없이도 동작(전역). 복원 씬에 선택 id 없으면 해제(id 제거 경로는 삭제·undo/redo뿐)
- **키보드 이펙트 통합**: undo/redo 브랜치(전역) + Del/R/Ctrl+D(선택 의존)를 하나로 — `isEditableTarget`·
  `gridOpen` 가드 유지, `e.repeat` 가드로 키 홀드 폭주 방지, `'zyZY'.includes(e.key)` 분기
- 스냅샷은 **배열 참조 공유**(spread/map 불변 갱신 규칙 → dataUrl 문자열 중복 메모리 없음),
  업데이터 내 순수성 유지(randomUUID는 밖), Konva 객체 저장 금지 철칙 준수
- lint 규칙 대응: `react-hooks/set-state-in-effect` 위반 회피 — 선택 가드는 이펙트가 아닌
  undo/redo 콜백 내에서 처리
- 검증: typecheck(node+web) ✓ · lint 0경고 ✓ · vitest 33 passed ✓ · 빌드 ✓ ·
  Playwright E2E(프로덕션 빌드, `%TEMP%\opencode\s5s3.e2e.mjs`): 버튼 3단 상태 전이 · contain 수학
  (6890×4593.33 정합) · Ctrl+Z 임포트 복원 · Ctrl+Shift+Z 재적용 · 90° 회전 cover(k=2·bbox 피복·중심) ·
  undo 상태 복원 · 드래그→undo 원위치 · Del→undo 동일 id 부활 · Ctrl+Y 고갈 no-op · 20회 편집→20회 undo
  스텝별 복원 · 스택 drain(빈 씬·비활성→redo 부활) · 모달 중 Ctrl+Z 무시 · 버튼 경로 + 힌트 텍스트 ·
  콘솔 에러 없음 = **14/14 × 2회**

## 결정·변경 사항 (S5 세션 3)
- **fitToCanvas는 회전 바운딩 박스 기준** — 회전 항목도 "문서를 덮는/문서에 들어가는" 직관에 정합.
  원본 x/y는 결과 무관(항상 문서 중심 재배치)
- **스냅샷 = 배열 참조 공유** — PlacedImage 갱신은 항상 spread/map으로 새 객체를 만들므로 성립.
  얕은 참조 공유로 100단계 × N항목 dataUrl 복사 방지
- **undo/redo 100단계 상한은 코드 리뷰로만 확인**(slice(-UNDO_LIMIT) 단순식) — E2E에서 다중 스텝
  (20회)·drain·고갈만 실증, 정확히 100/101 경계는 단위화 생략
- **버튼 라벨**: 채우기(cover)·안에 맟춤(contain)·실행취소·다시실행 — 뷰 "맞춤"과 문자열 충돌 없음
  (E2E 로케이터는 exact 옵션 사용)
- **E2E 교훈 2건**: ① Konva 게터는 메서드 — waitForFunction 술어에서 `node.x`(괄호 누락)는
  함수 참조가 되어 NaN 비교 → 영원히 false ② 회전 상태 노드는 시각 중심이 문서 중심과 어긋남 —
  클릭 선택은 `getClientRect` 중심 좌표로 할 것

## 다음 세션
- 단계: **S6 세션 1 — 내보내기 파이프라인 연결: stdio JSON-RPC 사이드카 서버 + 풀해상도 렌더러**
  (PLAN.md 참조) · 세션 2: PSD·PNG 출력 + 진행 다이얼로그 + Photoshop 검증
- 핀포인트: `export-sidecar/server.py`·`export-sidecar/renderer.py`, `src/workers/`
- 사전 검토 사항: CLAUDE.md 철칙 — CMYK(Color Mode 4)·350 DPI 쓰기는 Python 사이드카(psd-tools)만,
  ag-psd 쓰기 금지 · 해상도 메타데이터(ResolutionInfo ID 1005) 기록 · Electron↔사이드카는 stdio
  JSON-RPC (uv 환경 `uv run ruff check .` / `uv run pyright` / `uv run pytest` 검증)
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S6 항목만 읽고 시작하세요.
S6 세션 1(stdio JSON-RPC 사이드카 서버 + 풀해상도 렌더러) 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
CMYK PSD 쓰기는 반드시 Python 사이드카(psd-tools)에서만 수행하고 ag-psd는 쓰지 마세요.
수정 대상은 export-sidecar/server.py·renderer.py와 src/workers/입니다.
```
