# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-01 / 완료: S0 — 저장소 스캐폴딩 + 토큰 절약 인프라

## 현재 상태
- S0 완료 — git 저장소(dev)·스캐폴딩·검증 통과·GitHub push. S1(PSD 쓰기 스파이크) 착수 전.

## 완료한 항목
- git init(dev 브랜치) + `.gitignore`/`.claudeignore`/`.clineignore` (WORKFLOW §6 + CLOUD §3.1 병합)
- `.devcontainer/` (CLOUD §4.1 — Node 22·Python 3.12·LittleCMS 호환)
- `package.json` + 최소 Electron 메인(빈 창, `DTF_SMOKE_TEST=1` 자동종료 훅) — Vite+React 본셋업은 S2
- `src/` 골격: `core/math`·`core/color`·`components/{canvas,toolbar,sidebar}`·`workers`·`types` (docstring-only)
- `export-sidecar/` 골격: `pyproject.toml`(psd-tools·Pillow·pytest·ruff·pyright) + `renderer`·`color`·`psd_writer`·`server` 빈 모듈 + `tests/`
- 검증: `npm run dev` exit 0(빈 창 스모크) · `uv run pytest` 1 passed(Python 3.12.14) · ruff/pyright 통과
- 도구: uv 0.12.8 신규 설치(winget) — 로컬 Python 3.14 대신 uv 관리 3.12 사용

## 결정·변경 사항
- Electron ^44.1.0 고정 — npm 설치 후 첫 실행 시 바이너리 지연 다운로드 확인(이후 캐시됨)
- `.gitignore`에 로컬 AI 도구 상태(`.omo/`, `.codegraph/`) 추가 — 문서 목록 외 판단, GitHub 동기화 제외 목적
- GitHub 저장소 private 생성(단일 `dev` 브랜치 push, `main`은 S8 검증 완료 시 PR)

## 다음 세션
- 단계: **S1 — PSD 쓰기 스파이크 (M0 게이트)** 세션 1/2 — 소형 자동검증 (PLAN.md 참조)
- 핀포인트: `export-sidecar/psd_writer.py`, `export-sidecar/color.py`, `tests/`
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S1 항목만 읽고 시작하세요.
먼저 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
수정 대상은 다음 파일뿐입니다: export-sidecar/psd_writer.py, export-sidecar/color.py, tests/
```
