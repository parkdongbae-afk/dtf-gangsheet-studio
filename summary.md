# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: S6 세션 2 (PSD·PNG 출력 + 진행 다이얼로그 + Photoshop 검증) — **S6 단계 전체 완료**

## 현재 상태
- **S6 완료 (세션 1·2)** — 세션 2: PNG(F9)·병합 옵션(F8)·NDJSON 진행 알림·Electron 사이드카
  매니저 IPC·진행 다이얼로그 UI·**Photoshop COM 자동 개봉 검증 5/5**. 다음은 **S7 패키징**(PLAN.md 참조).
- **S1 세션 2(실규격 포토샵 수동검증) 사실상 해소** — 이 머신에 Photoshop 설치 확인되어
  SKILL §4 체크리스트를 COM 자동화(`Photoshop.Application`)로 실시: 1m(3레이어·병합)·
  2m(레이어·병합)·PNG 전부 무경고 개봉, CMYK·350DPI·치수·레이어 수·캔버스 밖 레이어
  음수 Bounds(-493px) 보존 확인. 잔여: 사람 눈 육성 확인은 산출물(`%TEMP%\opencode\s6_2\*.psd`)로 가능.

## 완료한 항목 (S6 세션 2)
- 수정 파일: `export-sidecar/`(server·renderer·psd_writer·color + tests 4종)·
  `src/main/ipc/export.ts`(신규)·`src/main/index.ts`·`src/preload/index.ts`·`src/types/ipc.ts`·
  `src/workers/exportManifest.ts`(+test)·`ExportDialog.tsx`(신규)·`ProxyCanvas.tsx`·`main.css`
- **사이드카 확장**: 매니페스트 `format`("psd"|"png")·`flatten`(bool) 필드 — PNG는 RGB+알파
  그대로 저장(pHYs DPI 기록, F9), PSD 병합은 RGBA 합성→CMYK 1회→단일 "Merged 1" 레이어(F8).
- **진행 알림**: 항목 렌더 직후 `("items", i+1, total)`·저장 직전 `("write", total)` 콜백 →
  server가 NDJSON 알림 `{"jsonrpc":"2.0","method":"progress","params":{...}}`(id 없음)로 발신.
  클라이언트는 `method` 키 유무로 알림·응답 구분(응답은 항상 id 있음). 베어 모드는 진행 알림 없이 1줄 응답 유지.
- **Electron 메인**: `SidecarManager` — `python -u server.py` 스폰(UTF-8·readline·id 매칭·ping
  핸드셰이크 10s·stderr 꼬리 진단·BrokenPipe 방어·cancel=kill 후 재스폰). 파이썬 경로:
  `DTF_SIDECAR_PYTHON` → `export-sidecar/.venv` → PATH `python`. IPC: `export:save-dialog`·
  `export:render`(진행률 `export:progress` 이벤트 push)·`export:cancel`. E2E 훅 `DTF_EXPORT_TEST=매니페스트 경로`
  (DTF_SMOKE_TEST 패턴 계승 — 결과 JSON `.result.json` 기록 후 자동 종료).
- **UI**: ProxyCanvas "내보내기" 버튼 → `ExportDialog`(포맷 라디오·병합 체크박스[PSD 전용]·
  진행바·항목 카운터·취소·완료 결과[치수·레이어·소요]). 렌더 중 Esc·백드롭 닫기 차단.
- **성능·메모리 (실측 개선)**:
  - 1m 레이어 PSD **99.5초→2.1초**: psd-tools `save()`의 풀캔버스 float32 합성(1.42GiB)을
    우리가 PIL paste 합성한 실합성 프리뷰 주입으로 우회(레이어 CMYK 재사용 — 재변환 0).
  - 2m PSD **MemoryError(2.83GiB)→3.3초**: 캔버스 >100M px(≈2m)는 단색 RLE 프리뷰 주입
    (Photoshop은 레이어로 재합성하므로 표시 동일).
  - GCR 변환 청크화(1024행 스트립): 풀캔버스 float64 5.66GiB 할당 제거 — **2m 병합 28.6초 성공**.
  - CMYK 반전 의미론 실증: PSD 규격은 CMYK 채널 반전 저장 — 프리뷰 주입 시 `ImageChops.invert`
    (레이어 `PixelLayer.frompil`의 반전과 대칭). psd-tools 합성기는 저장형 의미론으로 동작.
- **버그 수정(세션 중 발견)**: 베어 매니페스트 모드 렌더 실패 시 프로세스 크래시 →
  `_dispatch`와 동일하게 -32602/-32603 오류 응답 1줄로 계약 통일(+회귀 테스트).
- **검증 전량**: pytest **57**·Vitest **45**·ruff/pyright 0에러·typecheck 0에러·lint 본 세션
  스코프 클린(잔여 6에러는 components/ 병렬 작업분)·`npm run build` 성공.
  **E2E**: Electron 실구동 1m PSD(2.1s)·1m PNG(0.8s)·2m PSD(3.3s) + CLI 병합 1m(45s)·2m(28.6s) —
  psd-tools 재검증 19/19. **UI E2E**(playwright-core `_electron`, 메인 다이얼로그 IPC만 스텁 — 앱 코드
  무변경): 문서 생성→임포트→다이얼로그(포맷 전환·병합 옵션 토글)→실렌더→완료·362MB PSD 생성.
  **Photoshop COM 5/5**(실측: Mode CMYK=3/RGB=2, Bounds는 원시 px).

## 결정·변경 사항 (S6 세션 2)
- **프리뷰 전략 3분기**(psd_writer.write_psd `preview` 파라미터): ① ≤100M px + 호출자 합성 →
  실합성 주입 ② >100M px → 단색 RLE ③ 폴백 → psd-tools 기본(느림). Photoshop은 개봉 시
  레이어로 재합성하므로 3분기 모두 표시 동일 — 비포토샵 뷰어(썸네일 등)만 단색(2m) 차이.
- **병합 PSD에서 프리뷰=단일 레이어 픽셀 공유** — 추가 합성 비용 0.
- **PSD 파일 크기 ~363MB@1m**(프리뷰 RLE가 거의 압축 안 됨) — S7 최적화 후보(RAW↔ZIP 압축 조사).
- **매니페스트 직렬화 최소화**: format·flatten은 기본값(psd·false)일 때 생략(2KB 상한 회귀 유지).
- **uv 비PATH 환경** 계속: `.venv\Scripts\{ruff,pytest,pyright}.exe` 직접 실행(pyright `--pythonpath`).
- **병렬 작업 지속**: `components/`·`src/renderer/src/lib/`·`package.json`(clsx 등)·`.agent/UXUI.md`는
  본 세션 범위 밖 — 미커밋·미수정 유지.

## 다음 세션
- 단계: **S7 — 패키징 (PyInstaller onefile 사이드카 → electron-builder 리소스 포함 → 클린 머신 설치 테스트)** (PLAN.md 참조)
- 핀포인트: `electron-builder.yml`, 사이드카 PyInstaller spec, `src/main/ipc/export.ts`(파이썬 경로 해석을 패키지 리소스로 확장 — `app.isPackaged` 분기), `npm run build:win`
- 사전 검토: preload/UI 변경 불필요(채널 동일). 사이드카 PyInstaller 빌드 시 psd-tools·Pillow·numpy
  hidden imports·청크 GCR 회귀(pytest를 번들 바이너리로 재실행) 확인. 클린 윈도우 머신 설치 테스트는
  사용자 협조 필요(또는 새 윈도우 유저 계정 프로파일로 대체).
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S7 항목만 읽고 시작하세요.
S7(패키징 — PyInstaller onefile 사이드카 + electron-builder 리소스 포함) 구현 계획을 3단계로 요약만 해주세요. 승인 후 코드를 작성하세요.
사이드카 통신은 기존 NDJSON JSON-RPC 프로토콜을 그대로 사용하고, src/main/ipc/export.ts의 파이썬 경로 해석만 패키지 경로(app.isPackaged)로 확장하세요.
수정 대상은 electron-builder.yml·PyInstaller spec(신규)·src/main/ipc/export.ts입니다.
```

