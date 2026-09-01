# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: S6 세션 1 (stdio JSON-RPC 사이드카 서버 + 풀해상도 렌더러)

## 현재 상태
- **S6 세션 1 완료** — NDJSON JSON-RPC stdio 서버(`server.py`)·풀해상도 렌더러(`renderer.py`)·
  TS 매니페스트 빌더(`src/workers/exportManifest.ts`) — pytest 44 passed · Vitest 43 passed ·
  ruff/pyright 0 에러 · **CLI 파이프라인 실증**(Electron 없이 매니페스트 파이프→CMYK PSD 생성).
  다음은 **S6 세션 2(PSD·PNG 출력 + 진행 다이얼로그 + Photoshop 검증)**.
- **S1 세션 2(실규격 포토샵 수동검증) 여전히 보류** — 포토샵 설치 머신에서 6,890×13,780 PSD 개봉 체크리스트(SKILL.md §4) 확인 필요.

## 완료한 항목 (S6 세션 1)
- 수정 파일: `export-sidecar/server.py`·`renderer.py`·`psd_writer.py`(LayerSpec 알파 확장)·
  `tests/`(신규 test_renderer·test_server + psd_writer 알파 테스트)·`src/workers/exportManifest.ts`(+test)·
  `tsconfig.web.json`(workers include 추가)
- **IPC 계약 (STDIO_GUIDE 준수)**: stdio로 이미지/Base64 절대 금지 — 전달은 파일 경로 + cm 좌표만
  담은 Light JSON Manifest(`output_path`·`canvas{width_cm,height_m,dpi}`·`items[{src,x_cm,y_cm,width_cm,
  height_cm,rotation}]`). Python이 디스크에서 원본 직접 로드.
- **server.py**: `\n` 구분 NDJSON JSON-RPC 2.0. `ping`/`render`/`shutdown` + **베어 매니페스트 원샷
  모드**(method 없이 output_path 한 줄 파이프 = CLI 검증 경로). 매 응답 `sys.stdout.flush()` +
  `python -u` 이중 방어, stdio UTF-8 강제 재구성(Windows cp949 사고 차단)·`newline="\n"`(CR 혼입 차단),
  진단은 stderr 전용, 표준 에러 코드(-32700/-32601/-32602 ManifestError/-32603), EOF 조용히 종료,
  BrokenPipe 무추적 종료. 알림(id 없음)은 무응답+stderr 로그.
- **renderer.py**: 매니페스트 엄격 파싱(필드 경로 포함 에러, 30,000px 한계 조기 검사+2m 분할 안내) →
  항목당 로드→LANCZOS 리사이즈→회전(`-rotation` — Konva 양수=시계/ PIL 반시계 보정, expand)→
  알파 분리→`color.rgb_to_cmyk`(GCR)→**바운딩 박스 단위 LayerSpec**(전체 캔버스 단일 래스터 금지로
  메모리 절약). 레이어 배치 수학 = placement.ts fitToCanvas와 동일(중심−회전치수/2, 음수 좌표 보존).
- **알파(백색 잉크) 계약**: PIL CMYK는 알파 불가 → psd-tools 공식 경로 USER_LAYER_MASK(채널 -2)로
  저장(`LayerSpec.alpha` 추가). 완전 불투명(min=255)이면 마스크 생략. 회전 방향·마스크 픽셀값을
  비대칭 알파 PNG로 단정 테스트.
- **exportManifest.ts**: `PlacedImage[]`(절대 px)→cm 매니페스트 순수 변환. px↔cm 왕복 무손실
  (6890/13780/27559) 검증 + **항목 키 6개 고정·직렬화 2KB 상한 회귀 테스트**(바이너리 유출 방지).
- **CLI 실증(가이드 레시피 그대로)**: ① 베어 매니페스트 `Get-Content manifest.json | python -u
  server.py` → 1줄 응답 + PSD 생성(251ms) ② NDJSON 3요청(ping/render/shutdown) → 응답 3줄·id 정합·
  stdout CR 무혼입·CMYK(ColorMode 4)·1378×689·레이어 2·마스크 부착 — 모두 통과
  (드라이버: `%TEMP%\opencode\s6_cli_check.py`).

## 결정·변경 사항 (S6 세션 1)
- **매니페스트 좌표 단위는 cm**(STDIO_GUIDE 예시 스키마 그대로) — 에디터 px→cm→Python px 왕복은
  float64로 무손실(±0.5px 미만, 양측 반올림 규칙 통일: TS Math.round = Python floor(x+0.5)).
- **cm→px 환산은 Python이 최종 수행** — PSD 내부 치수의 단일 진실원.
- **CMYK+알파는 USER_LAYER_MASK 채널(-2)** — psd-tools `PixelLayer.frompil`이 CMYK PSD의 알파를
  마스크로 저장하는 공식 동작. 마스크 채널 구성 [-2,-1,0,1,2,3] 라운드트립 테스트로 고정.
- **레이어명 = `{파일스템} {n}`** — 동일 파일 그리드 복제 시 충돌 없는 결정적 이름.
- **uv가 PATH에 없는 환경** — `.venv\Scripts\{ruff,pytest,pyright}.exe` 직접 실행으로 검증
  (pyright는 `--pythonpath .venv\Scripts\python.exe`). `uv run` 사용자는 기존 명령 그대로.
- **병렬 작업 발견**: 작업 중 `package.json`(clsx·lucide-react·tailwind-merge 추가)·`components/`
  (shadcn 스타일, 미트래킹) 변경이 워킹트리에 나타남 — 본 세션 범위 밖이므로 미커밋·미수정.
  lint 에러 6건은 전부 이 `components/` 발(본 세션 파일은 클린).

## 다음 세션
- 단계: **S6 세션 2 — PSD·PNG 출력 + 진행 다이얼로그 + Photoshop 검증(SKILL §4 전체)** (PLAN.md 참조)
- 핀포인트: `src/main/`(사이드카 스폰 IPC — `python -u`, NDJSON 클라이언트), `src/preload/index.ts`,
  `src/renderer/src/components/canvas/ProxyCanvas.tsx`(내보내기 UI 진입), `export-sidecar/server.py`(PNG 확장)
- 사전 검토: 이번 세션 CLI 실증 완료된 프로토콜(ping/render/shutdown·에러 코드·UTF-8) 그대로 재사용 —
  Electron 메인은 `child_process.spawn(python, ['-u', server.py])` + 줄 단위 읽기. F8(레이어 보존/병합
  옵션)·F9(PNG 알파 보존) 완성.
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S6 항목만 읽고 시작하세요.
S6 세션 2(PSD·PNG 출력 + 진행 다이얼로그 + Photoshop 검증) 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
CMYK PSD 쓰기는 반드시 Python 사이드카(psd-tools)에서만 수행하고 ag-psd는 쓰지 마세요.
사이드카 통신은 S6-1에서 확립된 NDJSON JSON-RPC(ping/render/shutdown, UTF-8, 매 줄 flush) 프로토콜을 그대로 사용하세요.
수정 대상은 src/main/·src/preload/index.ts·ProxyCanvas.tsx와 export-sidecar/server.py입니다.
```
