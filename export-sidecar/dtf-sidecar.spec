# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — DTF 내보내기 사이드카 onefile 번들 (S7).

빌드(package.json ``build:sidecar``): ``uv run pyinstaller dtf-sidecar.spec --noconfirm --clean``
산출: ``dist/dtf-sidecar.exe`` → electron-builder extraResources → 설치 경로
``resources/dtf-sidecar/dtf-sidecar.exe`` (src/main/ipc/export.ts 패키지 분기).

설계 노트:
- onefile: 단일 exe — 클린 머신에 파이썬/uv 불필요 (PLAN.md S7 완료 기준).
- console=True: stdio NDJSON 서버 — Electron이 windowsHide로 스폰하므로 창 없음.
- upx=False: UPX 압축 제외 — 백신 오탐·부트로더 손상 예방.
- hiddenimports: 프로젝트 임포트는 전부 정적이지만 PyInstaller 분석 누락 방어
  (psd-tools·PIL·numpy — summary.md S7 사전 검토 항목).
- rembg(v2 remove_bg): removebg.py가 지연 임포트하므로 정적 분석에 안 잡힌다.
  onnxruntime·cv2는 hooks-contrib 훅이 바이너리를 수집한다. 모델 가중치
  (*.onnx)는 번들하지 않는다 — 첫 사용 시 U2NET_HOME(Electron이 userData/models
  로 지정)으로 다운로드되며 이후 오프라인 재사용된다(REMOVEBG.MD §2와 동일
  캐싱 전략, 번들 용량 1GB+ 회피).
"""

a = Analysis(
    ["server.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        # psd-tools — PSD 쓰기 엔진(psd_writer.py)
        "psd_tools",
        "psd_tools.api.layers",
        "psd_tools.constants",
        "psd_tools.psd.image_data",
        "psd_tools.psd.image_resources",
        # Pillow — color.py의 ImageCms·psd_writer.py의 ImageChops
        "PIL.ImageCms",
        "PIL.ImageChops",
        # numpy — renderer.py·color.py GCR 스트립 수학
        "numpy",
        # rembg — removebg.py의 지연 임포트(v2 배경 제거)
        "rembg",
        "rembg.bg",
        "rembg.sessions",
        "rembg.sessions.birefnet_general",
        "rembg.sessions.u2net",
        "cv2",
        "onnxruntime",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="dtf-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
