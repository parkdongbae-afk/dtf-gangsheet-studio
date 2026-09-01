"""ImageCms 기반 RGB→CMYK 변환 — S1 세션 1.

에디터 캔버스는 항상 RGB로 렌더링하고, RGB→CMYK 변환은
내보내기 시 1회만 수행한다 (CLAUDE.md §1-2).

알파 채널(DTF 백색 잉크 영역)은 이 변환의 범위 밖이다 — PIL CMYK
모드는 알파를 담을 수 없으므로, 호출자가 알파를 별도로 분리한 뒤
RGB만 전달해야 한다 (S6 내보내기 파이프라인에서 연결).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageCms


class ColorConversionError(Exception):
    """색상 변환 오류 기본 타입."""


class UnsupportedImageModeError(ColorConversionError):
    """CMYK 변환 불가 모드 — 알파는 사전 분리, 그 외 모드는 RGB로 변환 후 전달."""

    def __init__(self, mode: str) -> None:
        super().__init__(f"unsupported mode {mode!r} for CMYK conversion — pass 'RGB'")
        self.mode = mode


class TransformFailedError(ColorConversionError):
    """ImageCms 변환이 이미지를 반환하지 않음 — 프로파일·모드 조합 불일치."""

    def __init__(self, profile_path: Path) -> None:
        super().__init__(f"ImageCms transform with profile {profile_path} produced no image")
        self.profile_path = profile_path


def rgb_to_cmyk(image: Image.Image, icc_profile_path: Path | None = None) -> Image.Image:
    """RGB 이미지를 CMYK(PIL 규약, 255=잉크 최대)로 변환.

    ``icc_profile_path``가 주어지면 LittleCMS(ImageCms) 색상관리 변환을,
    없으면 결정론적 GCR 수식으로 변환한다. 인쇄용 ICC 프로파일 교체는
    S6 내보내기 파이프라인에서 수행한다.

    :raises UnsupportedImageModeError: 입력이 'RGB' 모드가 아닌 경우
    """
    if image.mode != "RGB":
        raise UnsupportedImageModeError(image.mode)
    if icc_profile_path is not None:
        return _convert_with_profile(image, icc_profile_path)
    return _convert_gcr(image)


def _convert_with_profile(image: Image.Image, profile_path: Path) -> Image.Image:
    """ICC 프로파일 기반 변환 — 프로파일 경로 오류는 호출자에게 전파."""
    transform = ImageCms.buildTransform(
        ImageCms.createProfile("sRGB"),
        ImageCms.getOpenProfile(str(profile_path)),
        "RGB",
        "CMYK",
    )
    result = ImageCms.applyTransform(image, transform)
    if result is None:  # PIL 타입 계약: inPlace=True가 아니면 발생 불가
        raise TransformFailedError(profile_path)
    return result


def _convert_gcr(image: Image.Image) -> Image.Image:
    """표준 GCR 수식 변환 — K=1-max(R,G,B), 잉크 총량 최소화.

    순백·순흑처럼 분모(1-K)가 0이 되는 영역은 CMY=0으로 가드한다.
    """
    rgb = np.asarray(image, dtype=np.float64) / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    k = 1.0 - np.maximum(np.maximum(r, g), b)
    ink = 1.0 - k  # == max(R, G, B)
    has_ink = ink > 0.0
    denom = np.where(has_ink, ink, 1.0)
    c = np.where(has_ink, (1.0 - r - k) / denom, 0.0)
    m = np.where(has_ink, (1.0 - g - k) / denom, 0.0)
    y = np.where(has_ink, (1.0 - b - k) / denom, 0.0)
    cmyk = np.stack((c, m, y, k), axis=-1)
    return Image.fromarray(np.round(cmyk * 255.0).astype(np.uint8), mode="CMYK")
