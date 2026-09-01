# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: 자동 배치(Auto-Nesting, BATCH.md) + portable exe 빌드

## 현재 상태
- **자동 배치 구현 완료**: 툴바 "자동 배치" → NestingDialog(간격·회전 옵션·라이브
  미리보기) → MaxRects 밀집 패킹 적용, Ctrl+Z 복구 지원. BATCH.md 스펙 전 항목 구현.
- **portable exe 빌드 추가**: `build:win`이 NSIS 인스톨러와 단독 실행 파일을 모두
  산출 — `dist/dtf-gangsheet-studio-0.1.0-portable.exe` (271.5MB).
- **S8(최종 검증·릴리즈)는 아직 미수행** — 다음 세션 후보(+하단 결함 수정).

## 완료한 항목 (자동 배치 세션)
- **autoNesting.ts 신규** (`canvas/` — placement.ts와 동일한 순수함수+colocated test
  관례. 스펙의 `src/utils/` 대신 repo 실구조를 따름): MaxRects BAF(1차·잔여면적
  최소)+BSF(차선·단변 여유) 스코어링, 면적→최장변 내림차순 정렬(id 안정화로
  결정론 보장), 패킹 박스 = 회전축 박스 + gap(둘레 gap/2 패딩, cmToPx 350dpi),
  allowRotation 시 90° 자동 회전(치수 동일한 정사각 등은 단일 후보), 임의 각도
  항목은 회전 바운딩 박스로 패킹하고 각도 유지, 미배치 `unpackedIds` 보고,
  `usedHeightPx`(최하단 셀 하단 = Bounding Crop)·`efficiency`(원본 픽셀 면적 ÷
  사용 면적) 산출. 결과는 입력 순서로 반환.
- **Konva 회전 피벗 실측 확정**: rotation은 노드 원점(x,y) 피벗(중심 아님) —
  `getClientRect` 실측(rect90 → {x:80,y:100,w:20,h:50}). 회전 후 중심 =
  (x,y)+R·(w/2,h/2)이며 `originToCoverCell`은 fitToCanvas와 동일 계열 수학.
  autoNesting.test.ts가 getClientRect를 심판으로 0/30/45/90/-90/135° 셀 커버 +
  혼합 6항목 캔버스 내부·쌍비교썹 0 검증(피벗 규약 회귀 시 실패하도록 설계).
- **NestingDialog.tsx**: 간격 cm 0~10 step 0.1 기본 2.0, 90° 회전 토글(기본 ON),
  packImages 매 렌더 재계산 라이브 미리보기(배치 n개·사용 높이 m/px·효율%·
  미배치 경고), GridDialog 패턴(Escape·배경 클릭 닫기, 0개 배치 시 적용 잠금).
- **ProxyCanvas**: 툴바 "자동 배치" 버튼(Boxes 아이콘, 이미지 있을 때 활성),
  handleNestingConfirm — `commitImages` 스냅샷 커밋으로 Ctrl+Z 복구(스펙의
  "Zustand History"는 실제 아키텍처인 React 스냅샷 히스토리로 충족), 미배치
  항목은 현재 위치 유지, 모달 중 스페이스 팬·편집 단축키 가드에 nestingOpen 추가.
- **electron-builder.yml**: win.target에 `portable` 추가
  (artifactName `${name}-${version}-portable.${ext}`) — 인스톨러와 병행 산출.
- **검증**: lint 0경고 · typecheck 0에러 · **Vitest 73(신규 18)** · `build:win`
  완료(사이드카 PyInstaller → NSIS 271.7MB + portable 271.5MB, 사이드카 exe
  161.3MB 번들) · win-unpacked exe 부팅 스모크(10초 생존 후 정상 종료) 통과.

## 결정·변경 사항 (자동 배치 세션)
- **모듈 위치**: BATCH.md의 `src/utils/autoNesting.ts` → repo 관례상
  `src/renderer/src/components/canvas/autoNesting.ts` + colocated test.
- **회전 토글 기본 ON**: 패킹 밀도 극대화가 스펙 목표이고 대화상자에서 즉시
  해제 가능.
- **BAF 특성 기록**: 잔여면적 최소 선택 결과, 스택보다 나란히 배치가 선택될 수
  있음(폭 여유 0 우선) — 사용 높이 최소화 관점에서 유리.

## ⚠️ 발견된 기존 결함 (선재, 본 세션 미수정 — 차기 후보)
- **내보내기 회전 좌표 불일치**: `renderer.py`는 회전을 중심 기준(center =
  x+w/2, y+h/2 — PIL rotate expand)으로 해석하나 Konva 캔버스 렌더링은 원점
  피벗(회전 후 중심 = (x,y)+R·(w/2,h/2)) — **회전된 항목의 PSD 출력 위치가
  캔버스와 어긋남**(예: x=100,y=100,w=50,h=20,r=90 → 캔버스 [80,100]×[100,150],
  PSD [115,135]×[85,135]). 0°/180°는 일치. S6부터 선재하며 자동 배치 회전
  결과의 내보내기 정확성에 직접 영향 — renderer.py center 계산에
  R·(w/2,h/2) 보정 + 회귀 테스트 필요(placement.ts fitToCanvas 주석의 원점
  피벗 규약이 정확).

## 다음 세션
- 단계: **S8 — 최종 검증·릴리즈** (PLAN.md 참조) + 상기 회전 내보내기 결함 수정
- 핀포인트: SKILL §4 전체 체크리스트, 2m 문서 스트레스, `dev → main` PR,
  버전 태그, 클린 머신 설치 테스트(setup+portable exe), 자동 배치 실사용 UX 확인
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S8 항목만 읽고 시작하세요.
S8(최종 검증·릴리즈) 계획을 3단계로 요약만 해주세요. 승인 후 실행하세요.
시작 전 renderer.py 회전 좌표 결함(summary.md ⚠️ 항목) 수정을 먼저
포함시켜 주세요 — 자동 배치 회전 결과의 PSD 출력 정확성에 영향.
```
