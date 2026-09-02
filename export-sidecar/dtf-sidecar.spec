# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — DTF 내보내기 사이드카 onefile 번들 (S7).

빌드(package.json ``build:sidecar``): ``uv run pyinstaller dtf-sidecar.spec --noconfirm``
산출: ``dist/dtf-sidecar.exe`` → electron-builder extraResources 배치 경로
``resources/dtf-sidecar/dtf-sidecar.exe`` (src/main/ipc/export.ts 패키지 분기).

설계 노트:
- onefile: 파일 하나로 클린 머신 배포, uv 불필요 (PLAN.md S7 완료 기준).
- console=True: stdio NDJSON 서버 — Electron이 windowsHide로 스폰하므로 콘솔 안 보임.
- upx=False: UPX 압축 제외 — 백신 오탐·부팅 지연 이상 방지.
- hiddenimports: 프로젝트 코드의 지연 임포트를 정적 분석이 놓치는 것 방어
  (psd-tools·PIL·numpy 등 summary.md S7 사전 검증 때 확인).
- rembg(v2 remove_bg): removebg.py가 지연 임포트하므로 명시 포함.
  onnxruntime·cv2는 hooks-contrib 훅이 바이너리를 수집한다. 모델 가중치
  (*.onnx)은 번들하지 않는다 — 첫 사용 시 U2NET_HOME(Electron은 userData/models
  지정)으로 다운로드되며 이후 오프라인 재사용된다(REMOVEBG.MD §2 — 모델 미번들
  캐싱 전략, 번들 용량 1GB+ 회피).
- copy_metadata(v2 결함 수정): pymatting ``__init__``이 ``importlib.metadata
  .version("pymatting")``을 **가드 없이** 호출한다. PyInstaller는 모듈은 번들하지만
  dist-info 메타데이터는 copy_metadata로 명시 수집해야 한다 — 누락 시 번들 exe에서
  ``PackageNotFoundError: No package metadata was found for pymatting``으로
  remove_bg 전체가 실패(2026-09-02 portable 실사용 접수, u2netp E2E 적색→녹색 검증).
  rembg 메타데이터도 함께 수집(가드되어 있어 필수는 아니나 부수 이득 — 버전 0.0.0 방지).
"""

from PyInstaller.utils.hooks import copy_metadata

a = Analysis(
    ["server.py"],
    pathex=[],
    binaries=[],
    datas=copy_metadata("pymatting") + copy_metadata("rembg"),
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
