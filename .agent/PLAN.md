# PLAN.md — 단계별 제작 계획 (Quota-Friendly Stages)

Z.ai GLM Coding Plan의 5시간 할당량·토큰 한도를 고려해, 제작 과정을 **S0~S8 단계**로 분할한다.
한 단계는 1~3개 세션으로 구성되며, 모든 세션은 `WORKFLOW.md` 프로토콜로 운영한다:

- **세션 시작**: 새 세션 → `summary.md` + 이 문서의 해당 단계 항목만 읽기 (전체 탐색 금지)
- **세션 종료**: `summary.md` 갱신 → `/clear` (맥락 필요 시 `/compact`)
- **단계 종료**: WORKFLOW §3 자동 프로토콜 수행 (summary 갱신·검증·push·다음 단계 안내)

단계 매핑: S1 = DESIGN.md의 M0 게이트, S2~S3 = M1, S4~S5 = M2, S6 = M3, S7~S8 = M4.

---

## 단계 개요

| 단계 | 내용 | 선행 | 세션 수 |
|---|---|---|---|
| S0 | 저장소 스캐폴딩 + 토큰 절약 인프라 | — | 1 |
| S1 | **PSD 쓰기 스파이크 (M0 게이트)** | S0 | 2 |
| S2 | Electron 골격 + 수학 코어 | S1 통과 | 2 |
| S3 | 프록시 캔버스 (줌/팬) | S2 | 1 |
| S4 | 이미지 임포트 + 배치(이동/선택) | S3 | 2 |
| S5 | 편집 완성 (크기·회전·복제·그리드·채우기·undo) | S4 | 3 |
| S6 | 내보내기 파이프라인 연결 (사이드카 IPC) | S5 | 2 |
| S7 | 패키징 (electron-builder + PyInstaller) | S6 | 1 |
| S8 | 최종 검증 · 릴리즈 | S7 | 1 |

---

## S0 — 저장소 스캐폴딩 + 토큰 절약 인프라
- **산출물**: git 초기화, `.gitignore` + `.claudeignore`/`.clineignore`(WORKFLOW §6 목록),
  `.devcontainer/`(CLOUD.md §4.1), `src/`·`export-sidecar/` 골격(빈 모듈+pyproject+package.json),
  `.agent/` 문서 저장소 반영, `summary.md`
- **핀포인트**: 루트 설정 파일들만 생성 (기존 코드 탐색 없음)
- **완료 기준**: `npm run dev` 빈 창 실행 · `uv run pytest` 통과 · GitHub 저장소 생성 후 push
- **토큰 포인트**: 생성 위주 작업 — 전체 프로젝트 읽기 금지

## S1 — PSD 쓰기 스파이크 (M0 게이트) ⚠️ 통과 전 S2 진입 금지
- **세션 1 (소형 자동검증)**: 500×500 CMYK 3레이어 PSD 생성 → psd-tools로 재독 검증
  (컬러모드=4, 레이어 수, 350DPI 리소스, 캔버스 밖 음수 좌표 레이어 보존) — `pytest` 자동화
- **세션 2 (실규격 수동검증)**: 6,890×13,780 CMYK 3레이어 + 캔버스 밖 확장 레이어 →
  Photoshop 개봉 체크리스트(SKILL.md §4) 수동 확인
- **핀포인트**: `export-sidecar/psd_writer.py`, `export-sidecar/color.py`, `tests/`
- **완료 기준**: 자동 테스트 통과 + Photoshop 무경고 개봉 · 실패 시 DESIGN §6 R1 폴백 검토

## S2 — Electron 골격 + 수학 코어
- **세션 1**: Vite+React+TS+Electron 셋업, 메인 윈도우, 신규 문서 다이얼로그(높이 1m/2m 선택, cm 표기)
- **세션 2**: `src/core/math/` — `cmToPx`, `getCanvasHeightPx`(PSD_MAX_PX 가드) + 단위테스트
- **핀포인트**: `src/core/math/`, `src/components/`, 일렉트론 설정 파일

## S3 — 프록시 캔버스
- Konva.js 스테이지, 문서 경계 사각형, 줌(휠)·팬(스페이스 드래그), 현재 배율 표시
- **핀포인트**: `src/components/canvas/`
- **완료 기준**: 1m/2m 문서를 프록시 해상도로 부드럽게 탐색

## S4 — 이미지 임포트 + 배치
- **세션 1**: 파일 대화상자 + 드래그앤드롭, 메인 프로세스에서 프리뷰(≤2,048px) 생성, 씬 배치
- **세션 2**: 선택/해제, 드래그 이동, Del 삭제
- **핀포인트**: `src/components/canvas/`, `electron/main/` IPC 핸들러

## S5 — 편집 완성
- **세션 1**: 리사이즈 핸들(비율 유지 기본), 회전(90°/1°)
- **세션 2**: 복제(Ctrl+D), 그리드 복제 대화상자(행×열·간격)
- **세션 3**: 화면 채우기(cover/contain), 실행취소/다시실행 커맨드 스택
- **핀포인트**: `src/components/canvas/interactions*`, `src/core/commands*`
- **완료 기준**: DESIGN F3~F7, S1 충족

## S6 — 내보내기 파이프라인 연결
- **세션 1**: stdio JSON-RPC 사이드카 서버 + 풀해상도 렌더러(바운딩 박스 단위)
- **세션 2**: PSD·PNG 출력 + 진행 다이얼로그 + Photoshop 검증(SKILL §4 전체)
- **핀포인트**: `export-sidecar/server.py·renderer.py`, `src/workers/`
- **완료 기준**: DESIGN F8, F9 충족

## S7 — 패키징
- PyInstaller onefile 사이드카 → electron-builder 리소스 포함 → 클린 Windows 머신 설치 테스트
- **핀포인트**: 빌드 설정 파일(`electron-builder.yml`, 사이드카 spec)
- **완료 기준**: DESIGN N1~N4 충족

## S8 — 최종 검증 · 릴리즈
- SKILL §4 전체 체크리스트, 2m 문서 스트레스 테스트, `dev → main` PR, 버전 태그
- **완료 기준**: 업체 납품 파일 샘플 생성 성공

---

## v2 이후 (별도 계획)
- 배경 제거(rembg) — DESIGN §8 설계 참조, 임포트 전처리 단계로 추가
