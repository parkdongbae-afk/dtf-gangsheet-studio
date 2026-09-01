"""color.rgb_to_cmyk 계약 테스트 — S1 세션 1 headless 자동검증."""

import pytest
from PIL import Image

import color


def test_rgb_to_cmyk_returns_cmyk_mode_image() -> None:
    # Given: RGB 단색 이미지 / When: 변환 / Then: PIL CMYK 모드 유지
    cmyk = color.rgb_to_cmyk(Image.new("RGB", (4, 4), (255, 0, 0)))
    assert cmyk.mode == "CMYK"
    assert cmyk.size == (4, 4)


def test_rgb_to_cmyk_primary_colors() -> None:
    # 순색 RGB → GCR 변환: R→(0,255,255,0), G→(255,0,255,0), B→(255,255,0,0)
    cases = [
        ((255, 0, 0), (0, 255, 255, 0)),
        ((0, 255, 0), (255, 0, 255, 0)),
        ((0, 0, 255), (255, 255, 0, 0)),
    ]
    for rgb, expected in cases:
        cmyk = color.rgb_to_cmyk(Image.new("RGB", (1, 1), rgb))
        assert cmyk.getpixel((0, 0)) == expected, f"RGB{rgb} → {expected} 실패"


def test_rgb_to_cmyk_white_uses_no_ink() -> None:
    # 순백 = 잉크 0 → CMYK (0,0,0,0) — DTF 무잉크 영역 계약
    cmyk = color.rgb_to_cmyk(Image.new("RGB", (1, 1), (255, 255, 255)))
    assert cmyk.getpixel((0, 0)) == (0, 0, 0, 0)


def test_rgb_to_cmyk_black_uses_k_channel_only() -> None:
    # 순흑 = K 단독 → CMYK (0,0,0,255) — 잉크 총량 최소 GCR 계약
    cmyk = color.rgb_to_cmyk(Image.new("RGB", (1, 1), (0, 0, 0)))
    assert cmyk.getpixel((0, 0)) == (0, 0, 0, 255)


def test_rgb_to_cmyk_rejects_alpha_input() -> None:
    # 알파(DTF 백색 잉크)는 이 변환의 범위 밖 — 조용한 유실 금지, 타입 오류로 거부
    with pytest.raises(color.UnsupportedImageModeError):
        color.rgb_to_cmyk(Image.new("RGBA", (1, 1), (255, 0, 0, 128)))
