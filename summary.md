# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: S5 세션 2 (복제·그리드)

## 현재 상태
- **S5 세션 2 완료**: Ctrl+D 복제(화면 24px 오프셋·계단·사본 자동 선택) + 그리드 복제 대화상자
  (행×열·간격 cm, 결과 범위 프리뷰·롤 폭 50cm 초과 경고) — Playwright 실기동 검증 12/12 × 2회 통과.
  다음은 S5 세션 3(화면 채우기·undo/redo) — S5 단계의 마지막 세션.
- **S1 세션 2(실규격 포토샵 수동검증) 여전히 보류** — 포토샵 설치 머신에서 6,890×13,780 PSD 개봉 체크리스트(SKILL.md §4) 확인 필요.

## 완료한 항목 (S5 세션 2)
- 수정 파일: `src/renderer/src/components/canvas/` 내부 4개 —
  `placement.ts`(순수 함수 2개 추가)·`placement.test.ts`(+6 테스트)·`GridDialog.tsx`(신규)·
  `ProxyCanvas.tsx`(키보드·버튼·대화상자 연결) + `src/renderer/src/assets/main.css`(대화상자 스타일)
- **배치 수학 선검증(Vitest 26 passed)**: `calculateGridPositions(item, rows, cols, gap)` —
  셀 (0,0)=원본 자리, 스텝=치수+gap(절대 px), row-major, float 반올림 없음 ·
  `duplicateOffset(viewScale)` — 화면 24px ÷ 줌 배율 (S4 캐스케이드 상수 재사용, centeredTopLeft도 이 함수로 통일)
- **Ctrl+D 복제**: 선택 항목을 +24 화면px(줌 보정) 대각 오프셋에 순수 JSON 사본(`crypto.randomUUID()`,
  전 필드 상속 + x/y만 이동) 추가, **사본을 자동 선택** → 반복 Ctrl+D로 계단 누적. `preventDefault` 필수.
  `e.repeat` 가드로 키 홀드 폭주 방지
- **그리드 복제 대화상자(GridDialog)**: 행·열(1~50 상한 — 씬 노드 수 폭주 방지)·간격(cm 입력 →
  `cmToPx` 변환, 기본 1cm=138px) · 라이브 프리뷰 "총 N개(신규 N-1개) · 결과 W×H cm" +
  **롤 폭 50cm 초과 시 경고** · 셀 (0,0)=원본 자리 → 사본 rows×cols−1개, 회전·치수 상속
  (회전 항목 그리드는 원본 로컬 축을 따라 회전) · Esc/백드롭=취소, Enter(폼 제출)=적용
- **텍스트 인풋 도입에 따른 키보드 가드 재검토**(S4 메모 해소): window 키 리스너 전부
  `isEditableTarget`(input/textarea/contentEditable) 무시 + 대화상자 모달 중(`gridOpen`) 캔버스
  단축키(Space/Del/R/Ctrl+D) 전면 비활성 — E2E로 모달 중 Ctrl+D 무시 검증
- 그리드 버튼은 선택 없으면 disabled(투명도 0.4) — 선택/해제 시 활성/비활성 전이 E2E 검증
- 검증: typecheck(node+web) ✓ · lint 0경고 ✓ · vitest 26 passed ✓ · 빌드 ✓ ·
  Playwright E2E(프로덕션 빌드, `%TEMP%\opencode\s5s2.e2e.mjs`): 버튼 활성 전이·Ctrl+D 오프셋·
  계단 누적·사본 선택 추적·R키 90°·모달 중 단축키 무시·프리뷰 텍스트·2×3 간격 138px 배치 수학
  정합(사본 5/5)·id 유일·치수 상속·Esc 취소·Del·선택 해제·줌/맞춤 무회귀·콘솔 에러 없음 = **12/12 × 2회**

## 결정·변경 사항 (S5 세션 2)
- **그리드 셀 (0,0)=원본 자리** — "3행×4열" = 최종 12개(원본 포함), 사본은 11개 생성. 원본은 이동 없음
- **간격 입력은 cm, 내부는 절대 px** — 대화상자 경계에서 `cmToPx`(반올림) 1회 변환, 순수 함수는 px만 다룸
- **복제·그리드 모두 렌더 스코프에서 항목 해석 후 순수 updater** — `crypto.randomUUID()`를 setState
  업데이터 안에서 호출하지 않는다(StrictMode 이중 호출 시 순수성 보장)
- **그리드 사본의 회전**: 원본 각을 그대로 상속 — 좌표는 원본 로컬 축 기준 순수 평행이동(수학 무관),
  시각적으로는 그리드 전체가 원본 회전각을 따라 회전
- **행·열 상한 50**: 프록시 씬 Konva 노드 폭주 방지 (50×50=2,500개 상한)
- E2E 검증 정합 시 rot90 노드 기준 필터맅에서 "기준 항목 자신"은 expected(셀 (0,0) 제외 집합)에서
  빼야 함 — 사본만 세면 5/5

## 다음 세션
- 단계: **S5 세션 3 — 화면 채우기(cover/contain), 실행취소/다시실행 커맨드 스택** (PLAN.md 참조, S5 마지막)
- 사전 결정 사항(개발 철칙 준수): **`fitToCanvas(item, docW, docH, mode)` 순수 함수를 `placement.ts`에
  먼저 작성해 Vitest 선검증 후 UI 버튼(cover/contain)을 붙일 것** — cover=문서 폭/높이 완전 덮음(잘림 허용),
  contain=문서 안에 전체 수납, 둘 다 중심 정렬·비율 유지·회전 고려(회전된 항목은 바운딩 박스 기준),
  커밋은 절대 px(x/y/widthPx/heightPx)만.
- **Undo/Redo**: `PlacedImage[]` 전체 JSON 스냅샷 히스토리 스택(컴포넌트 내부 상태 유지, Konva 객체
  저장 금지 철칙) — setImages 래퍼에서 변경 전 스냅샷 push, Ctrl+Z=undo / Ctrl+Shift+Z(및 Ctrl+Y)=redo,
  상한(예: 100단계) 필요. 단축키도 `isEditableTarget` 가드 준수
- 키보드 단축키가 늘어나므로 이펙트 하나로 통합 정리 검토 + 힌트 텍스트 갱신
- 핀포인트: `src/renderer/src/components/canvas/` (placement.ts + placement.test.ts + ProxyCanvas.tsx)
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S5 항목만 읽고 시작하세요.
S5 세션 3(화면 채우기·undo/redo) 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
fitToCanvas(item, docW, docH, mode) 순수 함수를 Vitest로 먼저 검증하고 UI를 붙이세요.
undo/redo는 PlacedImage[] JSON 스냅샷 스택으로만 구현하세요(Konva 객체 저장 금지).
수정 대상은 src/renderer/src/components/canvas/ 내부입니다.
```
