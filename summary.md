# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-03 / 완료: 속성 패널 "사용자 메뉴얼 (PDF)" 버튼 + 메뉴얼 번들·설치본 교체 / 이전: 한글 레이어명 PSD 크래시 수정(luni 보존)

## 현재 상태
- **메뉴얼 버튼·번들 (2026-09-03 요청)**: 속성 패널 푸터(선택 유무 무관 상시 노출)에
  "사용자 메뉴얼 (PDF)" 버튼(BookOpen 아이콘) 추가 → `util:open-manual-pdf` IPC로
  번들 PDF를 기본 뷰어로 open. openGuidePdf.ts를 채널·파일명 파라미터화된
  registerOpenPdfIpc로 일반화(가이드·메뉴얼 2채널), preload openManualPdf·DtfApi
  타입 추가(인접 중복 주석 1줄 정리), electron-builder extraResources에
  resources/DTF_사용자_메뉴얼.pdf 추가. 메뉴얼 PDF에도 버튼 안내(3.4절 tip)를
  추가해 재생성(19면·566,627B). 검증: lint 0·typecheck 0·Vitest 105 ·
  Playwright DOM(정적 서빙 out/renderer — 문서 만들기→패널 푸터 버튼 1개·보임·
  title 정상, 콘솔 오류는 favicon 404뿐) · setup 287.3MB+portable 287.2MB 재빌드
  (실행 중 앱 없어 잠금 이슈 없음) · 무인 설치 exit 0 — win-unpacked·설치본 모두
  PDF 2종 번들 확인 · 부팅 스모크 8초 생존·정상 종료 ✓.
- **사용자 메뉴얼 PDF 제작 (2026-09-02 요청)**: `resources/DTF_사용자_메뉴얼.pdf`
  (19면·552KB, A4) — 실제 UI 소스(버튼명·단축키·제한값) 기반으로 작성. 구성:
  DTF/갱시트 개념 → 설치(setup/portable) → 화면 구성 → 5분 빠른 시작 → 기능 상세
  12절(문서 생성·가져오기·편집·속성 수치입력·레이어·이미지 복제·자동 배치·채우기/
  맞춤·배경 제거(내장+외부 5종)·보기 도구·undo·내보내기) → DTF 인쇄 지식(백색
  잉크=알파·350DPI 환산표) → **Q&A 8건(절차형) + FAQ 10건(문제 해결형)** → 제한·
  알려진 이슈(회전 PSD 어긋남·중간 저장 미지원 명시) → 단축키 부록. 제작 파이프라인:
  인쇄 최적화 라이트 테마 HTML → Edge headless `--print-to-pdf`(별도 의존성 없음).
  소스 HTML은 `C:\Users\Park\AppData\Local\Temp\opencode\manual_ko.html`(수정 후
  재변환 가능). 앱 번들+버튼 연결은 다음 항목(2026-09-03)으로 완료.
- **한글 파일명 내보내기 크래시 — 진짜 원인 발견·수정 (2026-09-02 재접수)**: 사용자가
  수정 빌드(portable)에서도 동일 오류 재발 → dev 기기(cp949)에서 재현 성공으로
  원인 특정. **범인은 로캘이 아니라 psd-tools 1.18의 하드코딩 코덱**: 한글 입력
  파일명이 레이어명(stem)이 되고, save()가 LayerRecord 파스칼명을 **mac_roman**
  ('charmap' 계열 — 오류 메시지의 정체)으로 인코딩하다 UnicodeEncodeError.
  `create_pixel_layer`(frompil)은 저수준 `LayerRecord.name=`에 원문을 그대로
  넣어, 고수준 name 세터의 '?' 폴백을 **우회**함(전 세션 "'?' 폴백 존재" 판단은
  고수준 기준이라 이 경로엔 무효 — 틀린 결론이었음). PYTHONUTF8·stderr 방어는
  이 코덱에 무효했지만 심층 방어로 유지.
- **수정**: psd_writer.write_psd에서 생성 직후 **고수준 `layer.name = spec.name`
  재지정** — 파스칼명은 mac_roman 세이프('?')로 강등, 원명은 **luni 유니코드
  블록**(Photoshop 표준 경로)에 온전히 보존. 포토샵·psd-tools 모두 한글 레이어명
  표시(리드백 '테스트 디자인 1' 실증).
- **검증**: venv 재현 스크립트(한글·이모지😀, PYTHONUTF8 유무 무관) 전부 녹색 ·
  **pytest 74(신규 1: 비-Latin 레이어명 라운드트립 — 파스칼 '?' 폴백+luni 원명
  단정)** · ruff 클린 · 사이드카 리빌드 → win-unpacked **DTF_EXPORT_TEST E2E**
  (앱과 동일 경로·env) ok — 한글 출력 PSD 380MB 생성·레이어명 보존 ✓ ·
  setup 273MB+portable 재빌드(실행 중 앱 2회째 종료 후) · 무인 설치 exit 0 ·
  설치본 사이드카 해시 일치 · 부팅 스모크 8초 생존·정상 종료 ✓.
- **"그리드 복제" → "이미지 복제" 표시명 변경 (사용자 요청)**: 툴바 버튼·속성 패널
  섹션/버튼·복제 다이얼로그 제목/aria-label 5곳. "그리드 표시 설정"(격자 오버레이)은
  별개 기능이라 기존 이름 유지. 내부 식별자(GridDialog·onOpenGrid 등)와 코드 주석의
  "그리드 복제"는 기능 설명 용어로 그대로 유지(최소 변경).
- **설치본 교체 완료**: setup.exe 재실행(무인 설치 exit 0) — 사용자의
  AppData\Local\Programs 설치본이 15:07 빌드로 교체됨. CDP 실측으로 툴바
  "이미지 복제" 표시·구명 소멸 확인. 이전 보고("속성·배경제거 사이트만 보임")는
  사용자 오해로 마감 — 속성 패널의 편집 메뉴는 이미지 선택 시에만 노출되는 정상 동작.
- **배경 제거 사이트 → 다이얼로그 전환 (사용자 접수)**: 인라인 사이트 섹션이 속성 패널을
  차지해 배경 제거·그리드 복제 버튼이 밀려 보이지 않던 문제 수정. 패널에는 컴팩트 버튼
  "배경 제거 사이트…"(Globe 아이콘, 배경 제거 버튼 아래 + 선택 없는 빈 상태에도)만
  남기고, 클릭 시 신규 `BgSitesDialog`(GridDialog 패턴 — 420px 모달, Escape·배경 클릭
  닫기, max-h 86vh 스크롤)에 사이트 5종 카드+DTF 추천 배지+Remove.bg 저해상도 주의+
  DTF 팁+가이드 PDF 버튼 이동. 다이얼로그 열림 상태(bgSitesOpen)는 ProxyCanvas로
  리프트해 기존 키보드 가드(스페이스 팬·편집 단축키)에 포함.
- **검증(다이얼로그 전환)**: lint 0·typecheck 0·Vitest 105 · Playwright(패널 인라인
  링크 0개=버튼 공간 복원, 버튼→다이얼로그 5사이트·배지 2·주의 1·PDF 버튼, Escape
  닫기) · 재빌드(setup 273MB·portable 272.8MB 14:18, PDF 번들 유지) · 부팅 스모크 ✓.
  참고: portable 실행 중엔 dist\portable.exe가 잠겨 electron-builder가 대기 타임아웃
  — 빌드 전 앱 종료 필요(2026-09-02 두 차례 동일, 사용자 승인 후 종료·재빌드).
- **배경 제거 사이트 섹션 추가**: 속성 패널 배경 제거 섹션 바로 아래(+선택 없을 때도 노출)에
  무료 AI 누끼 사이트 5종 링크 — Adobe Express·Erase.bg("DTF 추천" 배지, 원본 해상도
  보존), Photoroom 웹, Clipdrop(Stability AI), Remove.bg(⚠ 무료 시 저해상도 약 500px
  주의 아이콘). 각 카드에 특징 한 줄 + DTF 우선 사용 팁. 외부 링크는 기존
  setWindowOpenHandler→shell.openExternal 라우팅 재사용(target=_blank 앵커).
- **포토샵 클라우드 가이드 PDF 번들**: 루트 photoshop_cloud_guide.pdf(0.48MB)를
  resources/로 복사·extraResources 번들 — 새 IPC `util:open-guide-pdf`
  (openGuidePdf.ts: 패키지=process.resourcesPath 루트 / dev=프로젝트 resources 분기,
  사이드카 resolveCommand와 동일 패턴, existsSync 가드+openPath 오류 처리).
  속성 패널 하단 "포토샵 클라우드 가이드 (PDF)" 버튼 → 시스템 기본 뷰어로 열림.
- **검증**: lint 0경고 · typecheck 0에러 · Vitest 105 · Playwright DOM 검증(사이트 5개
  href·DTF 추천 배지 2·Remove.bg 주의 아이콘·팁·PDF 버튼, 선택 없는 상태에서도 섹션
  노출) · electron-builder 재빌드(setup 273MB + portable 272.8MB,
  win-unpacked/resources에 PDF 번들 확인) · 부팅 스모크 통과.
- **portable 배경 제거 결함 수정 완료 (2026-09-02 접수)**: 패키지 exe에서 remove_bg가
  `PackageNotFoundError: No package metadata was found for pymatting`(-32602)로 전면 실패 —
  PyInstaller가 pymatting **모듈**은 번들하지만 **dist-info 메타데이터**는 수집하지
  않는데, pymatting `__init__`이 `importlib.metadata.version("pymatting")`을 가드 없이
  호출하기 때문. spec에 `copy_metadata("pymatting")`(+rembg 방어적 포함) 추가.
  번들 exe 직접 E2E로 적색(동일 오류 재현, u2netp)→녹색(64×64 추론 성공,
  Format32bppArgb 알파 보존, 2회차 캐시 재사용) 검증 완료. dev에서 안 터진 이유:
  venv에 메타데이터 존재. v2 세션의 패키지 E2E는 export만 대상이라 누락됐던 결함.
- **편집기 뷰 옵션 구현 완료**: 문서 가로폭 5cm 단위 사용자 선택(기본 50cm·최대 1m),
  문서 바깥 상단/좌측 자(ruler), 그리드 표시 설정(간격 0.5~50cm·색상 8프리셋+커스텀·
  실선/대시/도트) — UXUI 다크 인더스트리얼 테마 준수, 전부 Vitest 선검증 순수함수 기반.
- **자동 배치 구현 완료**: 툴바 "자동 배치" → NestingDialog(간격·회전 옵션·라이브
  미리보기) → MaxRects 밀집 패킹 적용, Ctrl+Z 복구 지원. BATCH.md 스펙 전 항목 구현.
- **portable exe 빌드 추가**: `build:win`이 NSIS 인스톨러와 단독 실행 파일을 모두
  산출 — `dist/dtf-gangsheet-studio-0.1.0-portable.exe` (271.5MB).
- **S8(최종 검증·릴리즈)는 아직 미수행** — 다음 세션 후보(+하단 결함 수정).

## 완료한 항목 (편집기 뷰 옵션 세션 — 가로폭·자·그리드)
- **core/math**: `WIDTH_STEP_CM=5`·`MIN_WIDTH_CM=5`·`MAX_WIDTH_CM=100`(1m)·
  `WIDTH_PRESETS_CM`(5~100cm 20개)·`getCanvasWidthPx(cm)`(PSD 30,000px 가드,
  100cm=13,780px 한계 내) 신규. `CANVAS_WIDTH_PX`(50cm=6,890)·`DTF_WIDTH_CM=50`은
  기본값 용도로 유지.
- **App.tsx**: 문서 만들기 다이얼로그의 고정 "가로(DTF 롤 고정) 50cm"을 select
  드롭다운(5cm 단위, px 환산 표시)으로 교체. 기본 50cm.
- **ruler.ts 신규** (canvas/, 순수함수): `pickRulerScale` — 화면 1cm당 px에서 라벨
  간격(0.1~100cm 후보 중 ≥48px 첫 단계) 선택, 보조는 항상 라벨/5(48>8×5 불변식).
  `computeRulerTicks` — 보이는 cm 범위의 눈금(pos 화면 px·labeled 플래그),
  `rulerTickLabel` — 정수/소수 1자리 포맷.
- **RulerOverlay.tsx 신규**: 뷰포트 상단(22px)·좌측(22px) HTML canvas 2D 자. 문서
  좌표계 0cm=문서 좌상단, 줌/팬 실시간 추적, 문서 범위 하이라이트(zinc-800), 좌측
  라벨 90° 회전, 좌상단 코너 "cm". pointer-events-none·DPR 대응.
- **gridOverlay.ts 신규** (순수함수): `GridSettings`(visible·intervalCm·color·
  lineStyle)·`gridLinePositions`(문서 내부 격자 위치, 경계 0/끝 제외)·`gridDash`
  (dashed [6,4]/scale, dotted [1,4]/scale — 대시 길이=선 두계 화면 1px + round캡,
  solid undefined)·`clampGridIntervalCm`(0.5~50, 비유한 값→기본 5).
- **GridSettingsDialog.tsx 신규**: 표시 토글 스위치·간격(0.5~50cm)·색상 8프리셋
  스와치+커스텀 color input·선 스타일 3버튼(실선/대시/도트, CSS border 프리뷰).
  변경 즉시 라이브 반영(보기 옵션 — 히스토리 대상 아님), Escape·배경 클릭 닫기.
- **ProxyCanvas**: 그리드 레이어 — 단일 Konva `Shape` sceneFunc으로 전체 격자
  경로 1회 스트로크(노드 수 폭주 방지), strokeWidth·dash 1/scale 보정(줌 무관
  화면 1px), dotted는 round 라인캡. 툴바 "그리드" 버튼(Grid2x2, 표시 중 인디고
  활성 강조 — OverlayButton active 변형 신규). Stage `onDragMove` 뷰 동기화 추가
  (팬 중 자 실시간 추적, 기존엔 dragEnd에서만 커밋). 툴바/치수 HUD top-3→top-8
  (상단 자 22px 피해). 키보드 가드에 gridSettingsOpen 추가.
- **GridDialog**: overRoll 경고 기준을 정적 `CANVAS_WIDTH_PX`(50cm)에서 현재
  문서 `widthPx` prop으로 교체("문서 폭 초과!").
- **검증**: lint 0경고 · typecheck 0에러 · **Vitest 105(신규 32: math 6·ruler 13·
  gridOverlay 13)** · `npm run build` + `electron-builder --win` 완료(NSIS 271.7MB +
  portable 271.5MB, 사이드카 변경 없어 기존 exe 재사용) · win-unpacked exe 부팅
  스모크 8초 생존 후 정상 종료 통과 · **실브라우저 픽셀 검증**(정적 서빙 후
  Playwright): 가로 100cm 선택→HUD 13,780×13,780px ✓, 자 스트립 2개 렌더+줌 추적 ✓,
  그리드 실선/대시/도트·색상·간격(5→10cm 픽셀 절반) 실시간 반영 ✓ — 도트 초기
  구현(0.001px 대시)이 Chromium에서 렌더링 스킵되는 결함을 이 검증으로 발견·수정
  (대시 길이=선 두께).

## 결정·변경 사항 (편집기 뷰 옵션 세션)
- **가로폭 최소 5cm**: 요구는 "5cm 단위·최대 1m"로 최소 미지정 — 스텝 1개(5cm)를
  최소로 채택. 100cm=13,780px로 PSD 30,000px 한계 내 여유.
- **가로폭 변경 시점은 문서 생성 시**: 기존 높이 프리셋 UX와 동일. 생성 후 변경은
  음수좌표 허용 정책과 충돌 없으나 v1 범위 외.
- **자는 뷰포트 고정 스트립(포토샵/Figma 방식)**: 문서 좌표계 눈금(0cm=문서
  좌상단)이 줌/팬을 따라감. 문서에 붙은 이동식 자 대비 구현 단순·표준 관례.
- **그리드는 undo 히스토리 대상 아님**: 씬(PlacedImage[])이 아닌 보기 옵션이므로
  GridSettings는 히스토리 스냅샷에서 제외 — 스펙 "히스토리는 이미지 커밋만" 유지.
- **그리드 간격 0.5~50cm**: 2m 문서 0.5cm 최악 ~800선이나 단일 Shape 1회 스트로크
  라 무관. 문서 경계선(0·끝)은 문서 테두리와 겹쳐 제외.

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
