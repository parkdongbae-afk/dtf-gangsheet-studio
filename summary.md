# summary.md — DTF GangSheet Studio 진행 상황
갱신: 2026-09-02 / 완료: S7 패키징 (PyInstaller onefile 사이드카 + electron-builder 리소스 포함)

## 현재 상태
- **S7 완료**: `npm run build:win` 한 명령으로 사이드카 번들→앱 빌드→NSIS 인스톨러까지
  생성. 언팩 실행 패키지 모드 E2E(번들 exe 스폰→CMYK PSD 렌더·계약 검증) 통과.
  클린 머신 설치 테스트만 사용자 협조로 남음(S8에서 실시).
- **UXUI Phase 0~3 작업분은 여전히 미커밋** — S7 커밋과 분리됨(아래 목록 참조).
  다음 세션 첫 작업으로 정리 커밋 필요.

## 완료한 항목 (S7 세션)
- **PyInstaller onefile 사이드카**: `export-sidecar/dtf-sidecar.spec` 신규(onefile,
  hiddenimports psd-tools·PIL.ImageCms/ImageChops·numpy, upx=False 백신 오탐 방지,
  console=True+windowsHide 스폰). pyinstaller 6.22.2 dev 의존성 추가(uv add). 산출 25.7MB.
- **번들 바이너리 GCR 회귀**: 3색 밴드 소스(아이템 높이 3,031px — GCR 스트립 경계
  1,024·2,048행 관통) 매니페스트를 번들 exe에 직접 파이프(베어 매니페스트 모드) →
  PSD 계약 검증(치수·ColorMode 4·350DPI 16.16 원시 블록·스트립 경계 순색 픽셀) 통과.
- **`src/main/ipc/export.ts`**: `resolvePython`→`resolveCommand` 재구성.
  `app.isPackaged`면 `resources/dtf-sidecar/dtf-sidecar.exe`를 **인자 없이** 스폰.
  `DTF_SIDECAR_PYTHON`은 확장자 .exe면 번들로 간주(E2E 오버라이드). 프로토콜·채널 불변.
- **`electron-builder.yml` 재작성**: appId `com.dtfgangsheet.studio`·productName
  `DTF GangSheet Studio`, extraResources(exe→`dtf-sidecar/dtf-sidecar.exe`), files
  제외 정리(export-sidecar·components·에이전트 문서), win-only(nsis) — mac/linux 템플릿 제거.
- **`package.json`**: `build:sidecar` 신규 + `build:unpack`/`build:win`에서 체인.
- **검증 전량**: typecheck 0에러 · Vitest 55 · ruff/pyright 클린 · pytest 57 ·
  `npm run build:win` 성공(인스톨러 137.3MB — `dist\dtf-gangsheet-studio-0.1.0-setup.exe`) ·
  언팩 패키지 모드 E2E `DTF_EXPORT_TEST` → ok + PSD 계약 검증 통과 ·
  dev 모드(`npx electron .` → .venv 스폰) 회귀 통과.
  스크립트·산출물: `%TEMP%\opencode\s7\`(prep.py·verify.py·매니페스트·PSD).

## 결정·변경 사항 (S7 세션)
- **extraResources `to`는 파일 전체 경로**: 디렉터리명만 쓰면 확장자 없는 파일로
  복사됨(첫 빌드 ENOENT 원인) — 경로 계약을 yml·export.ts 양측 주석에 명시.
- **클린 머신 요건**: 설치 머신엔 Python/uv 불필요(onefile 자급). 빌드 머신엔 uv 필요 —
  이 머신 `~\.local\bin`에 uv 0.12.8 설치(사용자 PATH 등록 — 새 셸부터 적용).
- **PowerShell 5.1 함정 2종 기록**: `Set-Content -Encoding UTF8`은 BOM 부여 →
  JSON.parse 실패(무BOM 필요 시 `[IO.File]::WriteAllText` 사용) · 한글 포함 git
  출력은 PS 파이프라인 캡처 대신 cmd 리다이렉트로 바이트 보존.
- **package.json 분리 스테이징**: 병렬 UXUI분(UI 의존성 5종)은 미커밋 유지, S7
  scripts 블록만 선택 스테이징(`%TEMP%\opencode\s7\stage-pkg.ps1` 방식).

## 미커밋 UXUI Phase 0~3 작업분 (S7 커밋에서 제외 — 다음 세션 정리)
- `src/renderer/` 일괄(App.tsx·main.css·ProxyCanvas·ExportDialog·GridDialog·
  placement.ts·PropertiesPanel.tsx 신규·lib/) · `src/core/math/` · `components/`(목업) ·
  `electron.vite.config.ts`(tailwind) · `.agent/UXUI.md` · `package-lock.json` ·
  package.json 의존성 hunk(UI 5종) · `tsconfig.web.tsbuildinfo`

## 다음 세션
- 단계: **S8 — 최종 검증·릴리즈** (PLAN.md 참조) + 선행: UXUI 정리 커밋
- 핀포인트: SKILL §4 전체 체크리스트, 2m 문서 스트레스, `dev → main` PR, 버전 태그,
  **클린 머신 설치 테스트(사용자 협조 — 인스톨러 `dist\dtf-gangsheet-studio-0.1.0-setup.exe`)**
- 시작 프롬프트(복사):

```text
summary.md와 .agent/PLAN.md의 S8 항목만 읽고 시작하세요.
먼저 미커밋 UXUI Phase 0~3 작업분을 별도 커밋으로 정리하고(push 포함),
S8(최종 검증·릴리즈) 계획을 3단계로 요약만 해주세요. 승인 후 실행하세요.
클린 머신 설치 테스트는 인스톨러(dist\dtf-gangsheet-studio-0.1.0-setup.exe)로 진행합니다.
```
