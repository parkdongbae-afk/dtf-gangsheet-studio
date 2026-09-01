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
