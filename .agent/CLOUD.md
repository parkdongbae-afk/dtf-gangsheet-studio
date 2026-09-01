# CLOUD.md — 학교-집 GitHub 동기화 개발 환경 가이드

본 문서는 **DTF GangSheet Studio** 프로젝트를 **학교(실습실/노트북)**와 **집(데스크톱/개인 PC)**
어디서나 **GitHub 저장소의 내용을 기준으로 동일하게 작업**하기 위한 동기화 규격서입니다.

---

## 1. 핵심 원칙 — GitHub 단일 진실 원점 (Single Source of Truth)

모든 작업은 **항상 GitHub의 최신 상태에서 시작**하고, **끝날 때 GitHub에 반영**한다.

| 시점 | 필수 동작 |
|---|---|
| 작업 시작 전 (장소 무관) | `git pull origin dev` — 로컬을 GitHub 상태로 갱신 |
| 작업 종료 후 (자리를 뜰 때) | `git add .` → `git commit` → `git push origin dev` |

- 커밋하지 않은 변경을 로컬에 남긴 채 이동하지 않는다.
- 어느 장소에도 "GitHub보다 앞선 로컬 상태"를 두지 않는다.
- 문제가 생기면 기준은 언제나 **GitHub** — 로컬을 새로 클론해도 동일하게 작업 가능한 상태를 유지한다.

**해결해야 할 과제**:
1. 학교 PC의 보안·권한 제한 (→ §4 Dev Containers로 극복)
2. Windows와 macOS/Linux 간 경로·줄바꿈(CRLF/LF) 차이 (→ §2.2, §5)
3. 350DPI 대용량 테스트 에셋(.psd/.png, 수백 MB)의 Git 저장소 보호 (→ §3)

> ⚠️ **Photoshop 개봉 검증(PSD 품질 확인)은 로컬 Windows에서만 가능**하다.
> Codespaces/Dev Container에는 Photoshop이 없으므로, 검증 단계는 반드시 집(또는 학교) PC에서 수행.

### 1.1 표준 세션 루틴 (어디서든 동일)

```bash
# ── 작업 시작 ──
git pull origin dev
npm install && uv sync        # 의존성 변경분이 있으면 반영

# ── 작업 종료(자리를 뜰 때) ──
git add .
git commit -m "wip: [School] 캔버스 Fit-to-Fill 기능 구현 중 (1m 규격)"
git push origin dev
```

---

## 2. 브랜치 및 작업 흐름 (Branch Workflow)

```
[학교 PC/노트북] --(push)--> sync/school --(PR/merge)--> dev <--(PR/merge)-- sync/home <--(push)-- [집 데스크톱]
                                                                  |
                                              (검증 완료 시 PR) --> main
```

- `main`: 최종 검증된 안정 버전.
- `dev`: 개발 통합 브랜치 — **평소 작업 기준 브랜치**.
- `sync/school` · `sync/home`: 두 장소에서 **동시에** 작업이 진행될 때만 쓰는 임시 브랜치.
- 1인 개발이면 `dev`에 직접 push하는 것을 기본으로 한다(장소가 달라도 §1의 pull→push 루틴만 지키면 충돌 없음).

### 2.1 크로스 플랫폼 Git 설정 (필수)
Windows와 macOS/Linux 혼용 시 줄바꿈 문제 방지:
```bash
# Windows 환경 (학교/집 PC)
git config --global core.autocrlf true

# macOS/Linux 환경 (노트북)
git config --global core.autocrlf input
```

---

## 3. 대용량 테스트 에셋 관리 (Asset Storage)

DTF 전사 특성상 350 DPI 고해상도 이미지 및 PSD 파일은 용량이 수백 MB에 달하므로
**GitHub 저장소에 직접 올리는 것을 금지**한다. 코드는 GitHub, 대용량 에셋은 클라우드 드라이브로 분리.

### 3.1 `.gitignore` 설정
```gitignore
# .gitignore
/dist
/node_modules
/.venv
/assets/test-highres/*   # 대용량 테스트 PSD/PNG 제외
!/assets/test-highres/.gitkeep
*.psd
*.tiff
.env.local
```

### 3.2 클라우드 에셋 동기화 (Google Drive / OneDrive)
- `assets/samples/` 폴더는 Google Drive 또는 OneDrive Shared Folder와 심볼릭 링크로 연결.
```bash
# Windows (cmd 관리자 권한)
mklink /D "C:\project\dtf-gangsheet-studio\assets\samples" "G:\My Drive\DTF_Test_Assets"

# macOS/Linux
ln -s ~/GoogleDrive/DTF_Test_Assets ./assets/samples
```

---

## 4. 동일 개발 환경 보장 (Dev Containers & Cloud IDE)

학교 PC의 설치 권한 부족 및 OS 환경 차이를 극복하기 위해 **Docker Dev Containers** 또는
**GitHub Codespaces**를 기본 환경으로 권장합니다.

### 4.1 VS Code Dev Containers (`.devcontainer/devcontainer.json`)
학교와 집 어디서나 동일한 Node.js 22, Python 3.12, LittleCMS 환경이 자동 구축됩니다.

```json
{
  "name": "DTF GangSheet Studio Dev Environment",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:22-bookworm",
  "features": {
    "ghcr.io/devcontainers/features/python:1": {
      "version": "3.12"
    }
  },
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "ms-python.python",
        "eamodio.gitlens"
      ]
    }
  },
  "postCreateCommand": "npm install && pip install pillow psd-tools pytest && pip install -e ./export-sidecar"
}
```

> 참고: v2 로드맵인 배경 제거(rembg)는 구현 단계에서 `pip install rembg`를 추가한다(무겁기 때문에
> 기본 컨테이너에서는 제외). Node 18/20은 LTS 종료에 따라 22 LTS 기준으로 유지한다.

### 4.2 GitHub Codespaces (학교 저성능 PC 대비)
- 학교 컴퓨터의 성능이 낮거나 네이티브 빌드 도구 미설치 시 **GitHub Codespaces**를 가동.
- 저장소는 동일한 GitHub 원점이므로 §1의 pull→push 루틴 그대로 적용된다.
- 단, **PSD 개봉 검증·electron 실행 테스트는 로컬 Windows에서만 가능**(§1 참고).

---

## 5. 경로 독립성 및 환경 변수 (.env)

학교와 집의 절대 경로가 다르므로 코드 내에 절대 경로(`C:\Users\...`) 사용을 절대 금지합니다.

### 5.1 상대 경로 및 Path Resolver 패턴
```typescript
// bad.ts - 절대 경로 사용 금지
const samplePath = "C:\Users\school\Desktop\test.png";

// good.ts - Cross-platform path resolver 사용
import path from 'path';
const samplePath = path.resolve(__dirname, '../../assets/samples/test.png');
```

```python
# good.py (export-sidecar) - pathlib 사용
from pathlib import Path
sample_path = Path(__file__).parent.parent / "assets" / "samples" / "test.png"
```

### 5.2 환경 변수 설정 (`.env.example`)
```env
# 장소에 따라 다른 포트 및 설정
PORT=3000
DTF_DEFAULT_WIDTH_CM=50
DTF_DEFAULT_DPI=350
DTF_HEIGHT_PRESETS_M=1,2
EXPORT_TEMP_DIR=./tmp/export
```

---

## 6. 학교-집 이동 전 3분 체크리스트 (Summary Checklist)

- [ ] **[ 종료 ]** 작업 종료 시 `git pull origin dev` → 작업 → `git commit` → `git push origin dev` 완료.
- [ ] **[ 시작 ]** 도착 후 작업 시작 전 `git pull origin dev` + `npm install` / `uv sync` 확인.
- [ ] **[ Asset ]** 350DPI 대용량 테스트 파일 클라우드 드라이브에 업로드 확인 (GitHub 금지).
- [ ] **[ Config ]** 새 npm 패키지 `package.json` / 파이썬 의존성 `pyproject.toml` 기록 확인.
- [ ] **[ Workspace ]** VS Code 열린 탭 저장 및 이슈/TODO `CLAUDE.md`에 기록.
- [ ] **[ Verify ]** PSD 내보내기 검증(Photoshop 개봉)이 남아 있다면 — 로컬 Windows PC에서 진행할 것.
