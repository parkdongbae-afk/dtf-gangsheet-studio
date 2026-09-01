# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: v2 배경 제거(누끼) + UXUI Phase 0~3 정리 커밋

## 현재 상태
- **v2 배경 제거 구현 완료**: 선택 이미지 → 속성 패널 "배경 제거" 버튼 →
  rembg 사이드카 추론 → Defringe된 32-bit RGBA PNG로 에셋 치환(undo 가능).
- UXUI Phase 0~3 미커밋분은 정리 커밋(`7fc796a`)으로 분리 완료.
- **S8(최종 검증·릴리즈)는 아직 미수행** — 다음 세션 후보.

## 완료한 항목 (v2 세션)
- **사이드카**: `export-sidecar/removebg.py` 신규 — `remove_background_dtf()`
  (alpha_matting fg240/bg10/erode10 — REMOVEBG.MD 스펙값) +
  `apply_dtf_defringe()`(cv2 타원 커널 알파 침식, RGB 불변). 세션은 모델명별
  1회 캐싱(lazy — export 스폰 비용 불변), 처리 후 gc.collect().
- **서버**: `server.py`에 `remove_bg` JSON-RPC 메서드 — **경로 계약**
  `{input_path, output_path, model?, defringe_px?}`(스펙의 Base64는 STDIO_GUIDE
  위배로 조정). RemoveBgError → INVALID_PARAMS, 추론 실패 → INTERNAL_ERROR.
- **의존성**: `uv add rembg[cpu] opencv-python-headless` — rembg 2.0.81 +
  onnxruntime 1.29 (pymatting·numba는 rembg 기본 의존에 포함됨).
- **메인**: `src/main/ipc/removeBg.ts` 신규 — `image:remove-bg` 핸들러,
  출력 `userData/removebg/<uuid>.png` + makePreview 재사용. SidecarManager에
  `removeBg()` 추가(rendering→busy 세마포어로 상호 배타, 10분 타임아웃),
  스폰 env에 `U2NET_HOME=userData/models`.
- **렌더러**: PropertiesPanel "배경 제거" 섹션(Eraser/Loader2, 첫 사용
  다운로드 안내), ProxyCanvas handleRemoveBg — id 캡처 커밋(처리 중 선택
  변경 안전), Ctrl+Z 되돌리기 가능.
- **PyInstaller spec**: hiddenimports에 rembg·cv2·onnxruntime 추가.
  모델은 번들 미포함 — 첫 사용 시 U2NET_HOME에 다운로드(인스톨러 1GB+ 회피).
- **검증 전량**: ruff ✓ · pyright 0에러 · **pytest 73**(신규 16 — defringe
  순수 함수·세션 캐싱·dispatch 스텝) · lint 0경고(eslint ignores에 `**/.venv`
  추가 — rembg 설치로 생긴 site-packages JS 경고 대응) · typecheck 0에러 ·
  Vitest 55 · **실측 E2E**: server.py 스폰 → u2netp 다운로드 → 추론 →
  RGBA·치수·모서리 투명/중앙 불투명 검증 통과, 2회차 캐시 히트 확인.

## 결정·변경 사항 (v2 세션)
- **경로 계약 채택**: REMOVEBG.MD의 Base64 스트림은 프로젝트 STDIO_GUIDE
  (stdio 바이너리 금지) 위배 → 경로 기반으로 조정. 스펙 조정 4종은
  `.agent/DESIGN.md` §8 하단 표 참조.
- **에셋 치환 정책**: 알파 마스크 부착(DESIGN §8 초안) 대신 처리된 RGBA PNG로
  filePath·dataUrl 치환 — 내보내기 파이프라인 무수정 재사용 + undo 스냅샷 작동.
- **모델 캐싱**: 기본 birefnet-general(약 1GB, 최고 품질) — 첫 사용 시
  `userData/models`에 다운로드 후 오프라인. 번들 미포함은 용량 결정
  (S8 릴리즈 전 오프라인 설치판 필요 시 재검토).
- **eslint·prettier에 `**/.venv` 무시 추가** — 이후 파이썬 의존성 추가 시
  site-packages JS가 lint를 오염하는 문제 원천 차단.

## 다음 세션
- 단계: **S8 — 최종 검증·릴리즈** (PLAN.md 참조)
- 핀포인트: SKILL §4 전체 체크리스트, 2m 문서 스트레스, `dev → main` PR,
  버전 태그, 클린 머신 설치 테스트(인스톨러 재빌드 필요 — v2 의존성 반영),
  + (선택) birefnet 모델 번들 여부 결정
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S8 항목만 읽고 시작하세요.
S8(최종 검증·릴리즈) 계획을 3단계로 요약만 해주세요. 승인 후 실행하세요.
클린 머신 설치 테스트 전에 npm run build:win으로 인스톨러를 재빌드해야
합니다(v2 배경 제거 의존성 반영).
```
