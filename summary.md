# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-01 / 완료: S1 세션 1 (소형 자동검증) — S2 착수

## 현재 상태
- S1 세션 1 통과: 500×500 CMYK 3레이어 PSD 라운드트립 헤드리스 자동검증 완료 (pytest 15 passed).
- **S1 세션 2(실규격 포토샵 수동검증) 미완료 — 본 머신 포토샵 미설치. 타 기계에서 6,890×13,780 PSD 개봉 체크리스트(SKILL.md §4) 확인 필요.**
- 사용자 지시로 S2(Electron 골격 + 수학 코어) 진행 중.

## 완료한 항목
- `export-sidecar/color.py` — `rgb_to_cmyk()` (ImageCms ICC 선택 경로 + GCR 수식 폴백, 알파 입력 거부)
- `export-sidecar/psd_writer.py` — `write_psd()` (Color Mode 4, 350 DPI 리소스 1005, signed 음수 좌표, 30,000px 가드)
- `export-sidecar/tests/test_color.py` (5) + `tests/test_psd_writer.py` (9) — 음수 좌표 (-50,-50) 보존·5채널(투명-1+CMYK)·원시 바이트 350dpi fixed-point 16.16 직접 검증 포함
- 검증: pytest 15 passed · ruff 통과 · pyright 0 errors

## 결정·변경 사항
- **ResolutionInfo(리소스 1005) 실규격 판명: 16바이트 `I 2H I 2H`** (fixed 16.16 + int16 유닛) —
  exiftool `Photoshop.pm`(실측 파일 검증 파서)으로 확정. 24바이트 int32 가설은 기각.
  psd-tools `ResoulutionInfo`(업스트림 철자 오타) 디코더와 동일 레이아웃. 기록은 raw `struct.pack(">IHHIHH")`.
- CMYK 채널 반전 저장·5채널 구성은 psd-tools `create_pixel_layer`가 자동 처리 — 직접 패킹 불필요.
- 알파(DTF 백색 잉크)는 PIL CMYK가 담을 수 없어 `rgb_to_cmyk` 범위 밖 — S6에서 psd-tools 픽셀 마스크 경로로 연결.
- ICC 인쇄 프로파일 미부착 상태(무료 프로파일 라이선스 검토 필요) — 포토샵 무경고 개봉 여부는 S1 세션 2에서 확인.
- 사용자 선결정 (S3~S5 적용): ① 줌/팬은 Konva stage `scale`/`position` 속성만 사용, 캔버스 크기=viewport 고정
  ② 이미지 임포트는 렌더러로 바이너리 아닌 `file.path` 전달, 메인 프로세스에서 프리뷰(≤2048px) 리사이징
  ③ 노드 선택/드래그는 캔버스당 공유 `Konva.Transformer` 1개로 상태 관리

## 다음 세션
- 단계: **S2 — Electron 골격 + 수학 코어** (PLAN.md 참조)
- 세션 1: `npm create electron-vite@latest` 검증 골격 병합 + 신규 문서 다이얼로그 최소 UI(가로 50cm 고정, 세로 1m/2m 라디오)
- 세션 2: `src/core/math/` 순수 함수(`cmToPx`, `getCanvasHeightPx` + PSD_MAX_PX 가드) + Vitest 선검증
- 핀포인트: 루트 설정 파일들, `src/main/`, `src/preload/`, `src/renderer/`, `src/core/math/`
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S2 항목만 읽고 시작하세요.
먼저 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
수정 대상은 다음 파일뿐입니다: package.json, electron.vite.config.ts, tsconfig*.json, src/main/, src/preload/, src/renderer/, src/core/math/
```
