# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: S5 세션 1 (리사이즈 핸들·회전)

## 현재 상태
- **S5 세션 1 완료**: 기존 단일 공유 Transformer에 리사이즈(비율 유지 기본/Shift 자유 비율)·회전
  핸들 활성화 + R키 90° 회전 — Playwright 실기동 검증 12/12 × 2회 통과. 다음은 S5 세션 2(복제·그리드).
- **S1 세션 2(실규격 포토샵 수동검증) 여전히 보류** — 포토샵 설치 머신에서 6,890×13,780 PSD 개봉 체크리스트(SKILL.md §4) 확인 필요.

## 완료한 항목 (S5 세션 1)
- 수정 파일: `src/renderer/src/components/canvas/` 내부 3개 —
  `placement.ts`(순수 함수 2개 추가)·`placement.test.ts`(+4 테스트)·`ProxyCanvas.tsx`(모델·Transformer·키보드)
- **배치 수학 선검증(Vitest 20 passed)**: `normalizeRotation`((-180, 180] 래핑, -180→180 특수 케이스)·
  `commitTransform`(임시 scaleX/scaleY를 절대 px 치수로 확정 + 회전 정규화, 순수 JSON 반환)
- **Transformer 활성화(신규 트랜스포머 없음 — S4 단일 공유 인스턴스 속성만 변경)**:
  `resizeEnabled`·`rotateEnabled`·`keepRatio`(기본)·`shiftBehavior="inverted"`(Shift=자유 비율 —
  Konva 소스 확인: 기본 'default'는 Shift가 비율 강제 방향이므로 inverted 필수)·
  `enabledAnchors` 모서리 4개·`boundBoxFunc`(최소 5px — 반전/음수 치수 방지, 표준 Konva 레시피)·
  `anchorStroke` 선택색 통일
- **PlacedImage.rotation 필드 추가**(도 단위, -180 < r ≤ 180, 임포트 시 0) — 상태는 순수 JSON,
  Konva 노드는 뷰 역할 유지(철칙 준수)
- **onTransformEnd 커밋**: 노드 판독 → 임시 scale을 즉시 1로 리셋(Konva 공식 React 패턴 — react-konva는
  prop이 아닌 scale을 되돌리지 않음) → `commitTransform` 순수 함수로 x/y/widthPx/heightPx/rotation 커밋
- **R키 90° 회전**(e.repeat 가드) — 기존 Del 키보드 effect에 통합. 힌트 텍스트 갱신
- 검증: typecheck(node+web) ✓ · lint 0경고 ✓ · vitest 20 passed ✓ · 빌드 ✓ ·
  Playwright E2E(프로덕션 빌드, `%TEMP%\opencode\s5s1.e2e.mjs`): 앵커 5개 노출·기본 리사이즈 비율
  유지+scale 리셋·Shift 자유 비율·회전 핸들 각도 커밋·R키 +90°·R×4 누적 복귀·트랜스폼 후 이동 무회귀·
  Del·재임포트 rotation 0·줌/맞춤 무회귀·콘솔 에러 없음 = **12/12 × 2회**

## 결정·변경 사항 (S5 세션 1)
- **Transformer 앵커는 이름 토큰 조회** — 앵커 name은 `"bottom-right _anchor"` 조합이고 비활성
  앵커(모서리 외 4개)도 노드로 존재(비가시). E2E에선 `find('._anchor')` + `isVisible()` + 첫 토큰 키잍
- **앵커 활성화 후 `Transformer.getClientRect()`는 앵커 돌출부 포함** — 추적 검증은 getClientRect 비교가
  아니라 모서리 앵커 중심 ≈ 노드 모서리(화면좌표) 비교로 해야 함(드리프트 0.00px)
- **앵커 중심 = 테두리 모서리 좌표**(Konva가 offset으로 보정) — 회전 앵커는 top-center에서
  `rotateAnchorOffset`(기본 50 화면px) 위에 배치
- **keepRatio 커밋은 float 그대로**(반올림 없음) — S4의 x/y 커밋 방식과 일치, 반복 변환 시 오차 불누적
- 회전 커밋 각은 normalizeRotation 경유 — R키는 현재 각(자유 회전 포함 float)에 정확히 +90

## 다음 세션
- 단계: **S5 세션 2 — 복제(Ctrl+D), 그리드 복제 대화상자(행×열·간격)** (PLAN.md 참조)
- 사전 결정 사항(개발 철칙 준수): **`calculateGridPositions(item, rows, cols, gap)` 순수 함수를
  `placement.ts`에 먼저 작성해 Vitest로 연산 정밀도를 선검증한 뒤 UI(대화상자)를 붙일 것** — UI와
  좌표 계산 디버깅을 동시에 하지 않는다. 복제/그리드 모두 순수 JSON `PlacedImage[]` 조작으로만
  구현(신규 id는 `crypto.randomUUID()`, Ctrl+D는 화면 24px 오프셋 배치 — S4 캐스케이드 패턴 재사용).
  키보드 Ctrl+D는 브라우저 기본 북마크 동작이므로 `preventDefault` 필수
- 상태는 계속 컴포넌트 내부(리프트 불필요) — Undo/Redo 스택은 세션 3에서 `PlacedImage[]` JSON
  스냅샷 히스토리로 구현(Konva 객체 절대 저장 금지 철칙)
- 핀포인트: `src/renderer/src/components/canvas/` (placement.ts + ProxyCanvas + 대화상자 컴포넌트 가능)
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S5 항목만 읽고 시작하세요.
S5 세션 2(복제·그리드 복제) 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
calculateGridPositions(item, rows, cols, gap) 순수 함수를 Vitest로 먼저 검증하고 UI를 붙이세요.
수정 대상은 src/renderer/src/components/canvas/ 내부입니다.
```
