"""psd-tools 래퍼 — Color Mode 4(CMYK)·350 DPI(Image Resource 1005) PSD 쓰기.

바이너리 계약 (S1 세션 1 headless 검증 항목):

- 헤더 Color Mode = ``4``(CMYK) — ``3``(RGB)과 혼동 금지.
- 350 DPI: Image Resource 1005(``0x03ED``) ResolutionInfo를 fixed-point
  16.16 big-endian 16바이트(``I 2H I 2H``)로 기록 — 실제 Photoshop 파일
  레이아웃(exiftool ``Photoshop.pm`` 검증).
- 레이어 바운딩 박스(top/left/bottom/right)는 signed 값 — 캔버스 밖
  음수 좌표가 0으로 클리핑되지 않는다.
- CMYK 레이어 채널: 투명(-1) + C,M,Y,K(0..3) = 5개. 채널 반전 저장은
  PSD 규격이며 psd-tools가 자동 처리한다.
"""

from __future__ import annotations

import struct
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import Resource
from psd_tools.psd.image_resources import ImageResource

EXPORT_DPI: Final[int] = 350
PSD_MAX_PX: Final[int] = 30_000
_PIXELS_PER_INCH: Final[int] = 1  # ResolutionInfo 단위 코드: 1 = px/inch
_INCH_UNIT: Final[int] = 1  # 폭·높이 표시 단위: 1 = inch
_FIXED_POINT_SCALE: Final[int] = 65_536  # 16.16 fixed-point


class PsdWriterError(Exception):
    """psd_writer 오류 기본 타입."""


class CanvasSizeError(PsdWriterError):
    """PSD 치수 한계(변당 30,000px) 초과 — 2m 단위 분할 필요 (CLAUDE.md §1-3)."""

    def __init__(self, width: int, height: int) -> None:
        super().__init__(
            f"canvas {width}x{height}px exceeds PSD {PSD_MAX_PX}px limit — split to 2m rolls"
        )
        self.width = width
        self.height = height


class NonCmykLayerError(PsdWriterError):
    """레이어 이미지가 CMYK 모드가 아님 — color.rgb_to_cmyk()로 먼저 변환할 것."""

    def __init__(self, layer_name: str, mode: str) -> None:
        super().__init__(f"layer {layer_name!r} is {mode!r}, expected 'CMYK'")
        self.layer_name = layer_name
        self.mode = mode


@dataclass(frozen=True, slots=True)
class LayerSpec:
    """CMYK 레이어 배치 사양 — 좌표는 캔버스 원점 기준 signed(음수 = 캔버스 밖)."""

    image: Image.Image
    name: str
    top: int
    left: int


def write_psd(path: Path, size: tuple[int, int], layers: Sequence[LayerSpec]) -> None:
    """CMYK PSD 생성·저장 — Color Mode 4 · 350 DPI · 음수 좌표 보존.

    :raises CanvasSizeError: 캔버스 변 길이가 1..30,000px 범위 밖인 경우
    :raises NonCmykLayerError: 레이어 이미지가 CMYK 모드가 아닌 경우
    """
    width, height = size
    _check_canvas_size(width, height)
    _check_layers_cmyk(layers)
    psd = PSDImage.new("CMYK", (width, height))
    for spec in layers:
        psd.create_pixel_layer(spec.image, name=spec.name, top=spec.top, left=spec.left)
    psd.image_resources[Resource.RESOLUTION_INFO] = _resolution_info(EXPORT_DPI)
    psd.save(path)


def _check_canvas_size(width: int, height: int) -> None:
    if not (1 <= width <= PSD_MAX_PX and 1 <= height <= PSD_MAX_PX):
        raise CanvasSizeError(width, height)


def _check_layers_cmyk(layers: Sequence[LayerSpec]) -> None:
    for spec in layers:
        if spec.image.mode != "CMYK":
            raise NonCmykLayerError(spec.name, spec.image.mode)


def _resolution_info(dpi: int) -> ImageResource:
    """ResolutionInfo 리소스 블록 — fixed 16.16 (예: 350 DPI → 22,937,600).

    바이너리 레이아웃은 ``I 2H I 2H`` 16바이트로, 실제 Photoshop 파일과
    일치한다(exiftool ``Photoshop.pm`` 검증). 참고: psd-tools의 대응
    디코더 클래스 ``ResoulutionInfo``는 업스트림 철자 오타.
    """
    fixed = round(dpi * _FIXED_POINT_SCALE)
    return ImageResource(
        key=Resource.RESOLUTION_INFO,
        data=struct.pack(
            ">IHHIHH",
            fixed,
            _PIXELS_PER_INCH,
            _INCH_UNIT,
            fixed,
            _PIXELS_PER_INCH,
            _INCH_UNIT,
        ),
    )
