# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: S3 (프록시 캔버스) — 세션 1

## 현재 상태
- **S3 완료**: 프록시 캔버스(줌/팬/배율 표시) 구현 + Playwright 실기동 검증 통과.
- **S1 세션 2(실규격 포토샵 수동검증) 여전히 보류 — 포토샵 설치 머신에서 6,890×13,780 PSD 개봉 체크리스트(SKILL.md §4) 확인 필요.**

## 완료한 항목 (S3)
- `package.json`: `konva ^10.3.2` + `react-konva ^19.2.5` 추가 (React 19.2 호환, dependencies)
- `src/renderer/src/components/canvas/ProxyCanvas.tsx` 신규:
  - Stage 크기 = 뷰포트(창) 고정 + resize 추적 — 실제 메가픽셀 캔버스 생성 안 함
  - 문서 = 가상 좌표계(350 DPI 절대 px)의 흰색 Rect + 테두리(strokeWidth 2/scale → 화면 2px 유지)
  - 초기 뷰 fit-to-screen(여백 24px), 줌 클램프 2%~800%, 휠 줌(포인터 중심, exp 곱산)
  - 팬 = Space 홀드 → Stage 내장 draggable + onDragEnd 상태 동기화 (객체 좌표 직접 연산 없음 —
    줌/팬 전부 `stage.scale()`/`stage.position()`만 조작, CLAUDE.md §1 준수)
  - 오버레이: 문서 치수·배율 %·"맞춤" 버튼(배당 복원), 조작 힌트 — 전부 인라인 스타일(CSS 파일 미수정)
- `src/renderer/src/App.tsx`: 문서 생성 시 `ProxyCanvas` 마운트(기존 텍스트 표시 대체)
- 검증: `typecheck`(node+web) ✓ · `lint` ✓ · `vitest` 10 passed ✓ · `npm run dev` 부팅 ✓ ·
  Playwright 실기동(렌더러 5173): 1m(6% fit→8% 줌인→팬 좌표 +220/+160 정확 일치→맞춤 복원) ·
  2m(Stage=929×861 뷰포트, Rect=6,890×27,559, fit 3%→줌·팬 동작) · 콘솔 에러 없음(favicon 404 제외)

## 결정·변경 사항 (S3)
- Konva 변환은 캔버스 style.transform이 아닌 내부 드로우로 적용 — 검증 시 `window.Konva.stages[0].x()/.scaleX()` API로 확인할 것 (S4+ 검증 팁)
- react-konva 19.2.5 (peer: konva ^10, react ^19.2) — 전용 reconcile러, Vite 설정 변경 불필요
- 사용자 조작 전 리사이즈 시 자동 refit, 조작 이후에는 뷰 유지 (interactedRef)

## 다음 세션
- 단계: **S4 — 이미지 임포트 + 배치** (PLAN.md 참조) — 세션 1: 파일 대화상자+DnD, 프리뷰(≤2,048px) 생성, 씬 배치 / 세션 2: 선택/해제, 드래그 이동, Del 삭제
- 사전 결정 사항: 프리뷰 생성은 메인 프로세스(sharp 없이 Electron nativeImage 검토부터), 씬 배치는 ProxyCanvas Layer에 Image 노드 추가
- 핀포인트: `src/renderer/src/components/canvas/`, `src/main/` IPC 핸들러
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S4 항목만 읽고 시작하세요.
먼저 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
수정 대상은 다음 파일뿐입니다: src/renderer/src/components/canvas/, src/main/, package.json (필요 시)
```
