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
- 알파(DTF 백색 잉크 영역): PIL CMYK 모드는 알파를 담을 수 없으므로
  ``LayerSpec.alpha``를 주면 psd-tools 공식 경로인 픽셀 마스크
  (USER_LAYER_MASK, 채널 -2)로 저장한다 (``PixelLayer.frompil`` 문서
  참조 — CMYK PSD의 알파 저장 방식).
"""

from __future__ import annotations

import struct
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from PIL import Image, ImageChops
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer
from psd_tools.constants import Compression, Resource
from psd_tools.psd.image_data import ImageData
from psd_tools.psd.image_resources import ImageResource

EXPORT_DPI: Final[int] = 350
PSD_MAX_PX: Final[int] = 30_000
# psd-tools save()는 레이어 변경 시 풀캔버스 float32 합성을 강제한다 —
# 2m(190M px)에서는 할당이 2.8GiB를 넘어 MemoryError. 이 임계치(≈1m)까지는
# psd-tools 실합성 프리뷰, 초과 시 단색 프리뷰 주입으로 우회한다(Photoshop은
# 레이어로 재합성하므로 화면 표시에는 영향 없음).
PREVIEW_COMPOSITE_MAX_PX: Final[int] = 100_000_000
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
    """CMYK 레이어 배치 사양 — 좌표는 캔버스 원점 기준 signed(음수 = 캔버스 밖).

    ``alpha``는 레이어와 동일 크기의 'L' 모드 마스크 이미지(255=불투명).
    PIL CMYK가 알파를 담을 수 없어 USER_LAYER_MASK로 저장한다 —
    렌더러가 회전까지 마친 최종 알파를 전달한다.
    """

    image: Image.Image
    name: str
    top: int
    left: int
    alpha: Image.Image | None = None


def write_psd(
    path: Path,
    size: tuple[int, int],
    layers: Sequence[LayerSpec],
    preview: Image.Image | None = None,
) -> None:
    """CMYK PSD 생성·저장 — Color Mode 4 · 350 DPI · 음수 좌표 보존.

    프리뷰(합성 이미지 섹션) 전략 — psd-tools ``save()``는 레이어 갱신 시
    풀캔버스 float32 합성으로 저장에 ~95초/1m·2m에선 MemoryError를 낸다:

    - ``preview`` 전달(≤1m 권장): 호출자가 만든 PIL CMYK 합성을 반전 저장
      (Photoshop·psd-tools 읽기 의미론과 동일한 실합성 프리뷰)
    - ``preview=None`` & 캔버스 > :data:`PREVIEW_COMPOSITE_MAX_PX`(2m):
      단색 프리뷰 주입으로 합성 우회
    - 그 외: psd-tools 기본 실합성(느림 — 하위호환 폴백)

    Photoshop은 개봉 시 레이어로 재합성하므로 어느 경로든 표시는 동일하다.

    :raises CanvasSizeError: 캔버스 변 길이가 1..30,000px 범위 밖인 경우
    :raises NonCmykLayerError: 레이어 이미지가 CMYK 모드가 아닌 경우
    """
    width, height = size
    _check_canvas_size(width, height)
    _check_layers_cmyk(layers)
    psd = PSDImage.new("CMYK", (width, height))
    for spec in layers:
        layer: PixelLayer = psd.create_pixel_layer(
            spec.image, name=spec.name, top=spec.top, left=spec.left
        )
        if spec.alpha is not None:
            _attach_alpha(layer, spec)
    psd.image_resources[Resource.RESOLUTION_INFO] = _resolution_info(EXPORT_DPI)
    if preview is not None:
        _set_real_composite(psd, preview)
    elif width * height > PREVIEW_COMPOSITE_MAX_PX:
        _set_solid_composite(psd)
    psd.save(path)


def _set_real_composite(psd: PSDImage, preview: Image.Image) -> None:
    """호출자 합성(PIL 의미 CMYK)을 반전해 프리뷰로 저장 — 저장 시 합성 우회.

    PSD 규격은 CMYK 채널을 반전 저장하고 psd-tools 읽기(post_process)는
    이를 재반전하므로, 여기서 ``ImageChops.invert`` 로 맞춘다
    (``PixelLayer.frompil`` 이 레이어 채널에 하던 것과 대칭).
    """
    if preview.mode != "CMYK":
        raise PsdWriterError(f"preview must be a CMYK image, got {preview.mode!r}")
    stored = ImageChops.invert(preview)
    psd._record.image_data.set_data(
        [channel.tobytes() for channel in stored.split()], psd._record.header
    )
    psd._updated = False


def _set_solid_composite(psd: PSDImage) -> None:
    """단색(백색=무잉크) 프리뷰 주입 후 갱신 플래그 해제.

    psd-tools의 비공개 ``_record``·``_updated``에 접근한다 — save()가
    ``is_updated()``일 때 풀캔버스 합성을 강제하기 때문이며, 이 우회가
    없으면 2m 문서에서 MemoryError가 발생한다(모듈 머리글).
    RLE 압축 단색 평면은 수십 KB에 그친다. Photoshop은 개봉 시 레이어로
    재합성하므로 표시 결과는 동일하다.
    """
    header = psd._record.header
    psd._record.image_data = ImageData.new(
        header, color=255, compression=Compression.RLE
    )
    psd._updated = False


def _attach_alpha(layer: PixelLayer, spec: LayerSpec) -> None:
    """알파를 픽셀 마스크로 부착 — 크기 불일치는 저장 손상을 막기 위해 명시 검증."""
    if spec.alpha is None or spec.alpha.mode != "L":
        raise PsdWriterError(f"layer {spec.name!r} alpha must be an 'L' mode image")
    if spec.alpha.size != spec.image.size:
        raise PsdWriterError(
            f"layer {spec.name!r} alpha size {spec.alpha.size} != image size {spec.image.size}"
        )
    layer.create_mask(spec.alpha, top=spec.top, left=spec.left)


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
