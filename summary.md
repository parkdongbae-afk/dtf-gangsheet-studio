# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: S4 전체 (세션 2 — 선택/이동/Del 삭제)

## 현재 상태
- **S4 완료**: 세션 1(임포트+배치)에 이어 세션 2(선택/해제·드래그 이동·Del 삭제) 완료 —
  Playwright 실기동 검증 12/12 × 2회 통과. 다음은 S5(편집 완성) 세션 1.
- **S1 세션 2(실규격 포토샵 수동검증) 여전히 보류** — 포토샵 설치 머신에서 6,890×13,780 PSD 개봉 체크리스트(SKILL.md §4) 확인 필요.

## 완료한 항목 (S4 세션 2)
- 수정 파일: `src/renderer/src/components/canvas/ProxyCanvas.tsx` 1개 (신규 파일 없음)
- **선택**: `selectedId` 상태(컴포넌트 내부 — S5 세션 3까지 리프트 불필요) + 씬 Layer에 **단일 공유
  Konva.Transformer** 1개(`resizeEnabled=false`·`rotateEnabled=false` — 테두리 전용 #0ea5e9 2px,
  핸들·회전은 S5에서 활성화). 이미지 `onMouseDown` → 선택, Stage 빈 곳/문서 배경 Rect(`name`
  식별) 클릭 → 해제. 바인딩은 `stage.findOne('#id')`로 선택 노드만 `transformer.nodes([...])`
- **이동**: 이미지 `draggable={!spaceDown}` + `onDragEnd`에서 문서 좌표(350 DPI 절대 px)를
  `PlacedImage.x/y`로 커밋. Space 팬 모드에서는 stage.draggable이 우선(선택·이동 모두 차단,
  상호배제 구조). 트랜스포머는 바인딩 노드를 자동 추적(Konva 내장)
- **삭제**: 기존 키보드 effect 옆에 Del/Backspace → 선택 이미지 제거 + 선택 해제
- 조작 힌트 텍스트 갱신(클릭: 선택 · 드래그: 이동 · Del: 삭제)
- 검증: typecheck(node+web) ✓ · lint 0경고 ✓ · vitest 16 passed ✓ · 빌드 ✓ ·
  Playwright E2E(프로덕션 빌드 + 대화상자 메인 스텁, `%TEMP%\opencode\s4s2.e2e.mjs`):
  임포트 렌더·원본 px 크기·뷰 중심 배치 좌표·클릭 선택(최상위 바인딩)·드래그 이동 좌표 커밋
  (오차<0.5px)·다른 이미지 무변경·트랜스포머 추적·빈 곳 해제·Del/Backspace 삭제·Space 팬
  우선(이미지 무이동)·휠 줌/맞춤 무회귀·캐시 동일성·콘솔 에러 없음 = **12/12 × 2회**

## 결정·변경 사항 (S4 세션 2)
- **Konva.Transformer는 절대(화면) 좌표계로 렌더링** — 소스 확인 결과 `getAbsoluteTransform()`
  오버라이드로 조상(스테이지) 변환을 무시 → `borderStrokeWidth`는 줌 배율과 무관하게 항상
  화면 px(문서 Rect의 `2 / view.scale` 패턴 불필요). S5에서 앵커 크기도 동일하게 화면 px
- **Transformer 테두리 스트로크는 노드 경계에 중앙 정렬** → 트랜스포머 clientRect이 노드보다
  strokeWidth/2(=1px) 확장됨 — E2E 좌표 비교 허용오차 1.5px
- 트랜스포머 테두리 드래그 = 노드 이동 프록시(Konva `_proxyDrag` 내장) — 별도 구현 불필요
- 선택은 mousedown 기반(클릭→드래그 시작 즉시 선택). Space 홀드 중에는 선택 핸들러 가드로
  무시 — 팬 조작이 선택을 오염시키지 않음
- Del/Backspace 삭제는 현재 UI에 텍스트 인풋이 없어 전역 keydown으로 처리 — 인풋 도입 시
  포커스 가드 재검토 필요(코드 주석에 명시)
- S5 세션 1은 기존 트랜스포머의 `resizeEnabled`/`rotateEnabled` 활성화 + `onTransformEnd`
  커밋으로 직접 이어짐. `PlacedImage`에 `rotation`(및 리사이즈 후 widthPx/heightPx 갱신) 추가 필요

## 다음 세션
- 단계: **S5 세션 1 — 리사이즈 핸들(비율 유지 기본), 회전(90°/1°)** (PLAN.md 참조)
- 사전 결정 사항: 단일 공유 Transformer에 `enabledAnchors`(모서리 4개 권장 — 비율 유지
  `keepRatio` 기본)·`rotateEnabled` 활성화. `onTransformEnd`에서 절대 px로 x/y/widthPx/heightPx
  커밋(스케일 오프셋 주의: Konva transform은 scale로 들어오므로 width×scaleX 확정 후
  scaleX 리셋 패턴). 회전은 `PlacedImage.rotation` 신규 필드. 90° 회전은 별도 버튼/단축키로
  rotation += 90 정규화(-180~180). Shift = 자유 비율(기본 비율 유지과 반대 설계 — DESIGN 확인)
- 핀포인트: `src/renderer/src/components/canvas/` (ProxyCanvas + interactions 컴포넌트 가능),
  `src/core/`(수학 필요 시)
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S5 항목만 읽고 시작하세요.
S5 세션 1(리사이즈 핸들·회전) 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
기존 단일 공유 Konva.Transformer를 활성화하는 방식으로 구현하세요 (신규 트랜스포머 금지).
수정 대상은 src/renderer/src/components/canvas/ 내부입니다.
```
