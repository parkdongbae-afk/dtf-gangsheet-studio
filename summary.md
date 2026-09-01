# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-01 / 완료: S2 (Electron 골격 + 수학 코어) 세션 1·2

## 현재 상태
- S2 전 세션 완료: electron-vite 표준 골격 병합 + 수학 코어 Vitest 통과 + 신규 문서 다이얼로그 동작 확인.
- **S1 세션 2(실규격 포토샵 수동검증) 여전히 보류 — 포토샵 설치 머신에서 6,890×13,780 PSD 개봉 체크리스트(SKILL.md §4) 확인 필요.**

## 완료한 항목
- `npm create @quick-start/electron`(react-ts 템플릿) 병합: `src/main`·`src/preload`·`src/renderer`·
  `electron.vite.config.ts`·tsconfig 3종·eslint/prettier·`electron-builder.yml`(S7용) — 표준 구조 준수, 빌드 스크립트 최소 변경
- S0 `DTF_SMOKE_TEST=1` 자동종료 훅을 `src/main/index.ts`에 이식 (창 1280×800·제목 설정), 구 `electron/` 디렉터리 제거
- `src/core/math/index.ts`: `cmToPx`·`CANVAS_WIDTH_PX`(6,890)·`PSD_MAX_PX`(30,000)·`HEIGHT_PRESETS_M`·
  `getCanvasHeightPx`(1m→13,780 / 2m→27,559 / 3m→`CanvasSizeLimitError`) — 순수 함수, Vitest 10 passed
- 신규 문서 다이얼로그(`App.tsx`): 가로 50cm 고정 + 세로 1m/2m 라디오 + 생성 → `캔버스 6,890 × 13,780/27,559 px` 표시
- 검증: `typecheck`(node+web) ✓ · `lint` ✓ · `vitest` 10 passed · `DTF_SMOKE_TEST=1 npm run dev` exit 0 ·
  Playwright 실기동 검증(2m 선택→생성→"27559" 표시 확인)

## 결정·변경 사항
- `.gitignore`: `out/`(electron-vite)·`release/`(electron-builder)·`.eslintcache/`·`.playwright-mcp/` 추가,
  `build/` 제거(템플릿 아이콘 리소스 경로로 사용됨)
- Electron ^44.1.0 고정 유지(S0 결정 승계), react 19·vite 7·electron-vite 5·vitest 3 도입
- `tsconfig.web.json` include에 `src/core/**`·`src/types/**` 추가 — CLAUDE.md §2.1 상위 구조 유지(렌더러가 `../../core/math` 임포트)
- 사용자 오타 정정: PSD 최대 치수는 300,000px가 아닌 **30,000px** (CLAUDE.md §1-3·PSD 표준, 테스트로 고정)

## 다음 세션
- 단계: **S3 — 프록시 캔버스** (PLAN.md 참조) — Konva.js 스테이지, 문서 경계 사각형, 줌(휠)·팬(스페이스 드래그), 배율 표시
- 사전 결정 사항 적용: 줌/팬은 Konva `stage.scale()`/`stage.position()`만 사용, 캔버스 크기=viewport 고정
- 핀포인트: `src/components/canvas/` (렌더러 연결 구조: `src/renderer/src/components/` 검토)
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S3 항목만 읽고 시작하세요.
먼저 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
수정 대상은 다음 파일뿐입니다: src/renderer/src/components/canvas/, src/renderer/src/App.tsx, package.json (konva 의존성)
```
