"""autotrim 투명 여백 자동 트림 검증 — 알파 바운딩 박스·no-op 계약·DPI 보존.

모델 추론 없이 순수 이미지 연산이라 전 경로를 실파일로 단위 테스트한다:

- ``alpha_bbox`` — 임계값 미만 잔상(알파 1~5) 무시·최외각 좌표·완전 투명 None
- ``auto_trim_file`` — 크롭 정확도·no-op 원본 유지(완전 투명·여백 없음·JPG)·
  pHYs DPI 이어쓰기·입력 검증(파일 없음·임계값 범위)
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import autotrim


def _padded_png(
    path: Path,
    canvas: tuple[int, int] = (100, 80),
    box: tuple[int, int, int, int] = (10, 20, 60, 60),
    fill: tuple[int, int, int, int] = (10, 200, 30, 255),
    margin_alpha: int = 0,
    dpi: tuple[float, float] | None = None,
) -> Path:
    """캔버스 전체를 margin_alpha로 채우고 box 영역만 불투명 픽셀로 — box는 반개구간."""
    arr = np.zeros((canvas[1], canvas[0], 4), dtype="uint8")
    arr[..., 3] = margin_alpha
    left, top, right, bottom = box
    arr[top:bottom, left:right] = fill
    img = Image.fromarray(arr, "RGBA")
    if dpi is not None:
        img.save(path, dpi=dpi)
    else:
        img.save(path)
    return path


# --- alpha_bbox (순수 함수) ---


def test_alpha_bbox_returns_outermost_coords() -> None:
    img = Image.new("RGBA", (100, 80), (0, 0, 0, 0))
    px = img.load()
    for y in range(20, 60):
        for x in range(10, 60):
            px[x, y] = (10, 200, 30, 255)
    assert autotrim.alpha_bbox(img) == (10, 20, 60, 60)  # 반개구간 right/bottom


def test_alpha_bbox_threshold_ignores_faint_residue() -> None:
    """알파 1~5 잔상 — 기본 임계값 10이면 무시되고, 0이면 바운딩 박스가 캔버스 전체."""
    img = Image.new("RGBA", (50, 50), (0, 0, 0, 0))
    px = img.load()
    for y in range(5, 45):
        for x in range(5, 45):
            px[x, y] = (10, 200, 30, 255)
    px[0, 0] = (10, 200, 30, 3)  # 좌상단 모서리 잔상
    px[49, 49] = (10, 200, 30, 5)  # 우하단 모서리 잔상
    assert autotrim.alpha_bbox(img) == (5, 5, 45, 45)
    assert autotrim.alpha_bbox(img, threshold=0) == (0, 0, 50, 50)


def test_alpha_bbox_none_for_fully_transparent() -> None:
    assert autotrim.alpha_bbox(Image.new("RGBA", (30, 30), (0, 0, 0, 0))) is None


def test_alpha_bbox_threshold_boundary_is_exclusive() -> None:
    """임계값과 같은 알파는 보이지 않는다 — 판정은 alpha > threshold (엄격 초과)."""
    img = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    px = img.load()
    px[2, 2] = (10, 200, 30, 10)  # == 기본 임계값
    px[7, 7] = (10, 200, 30, 11)  # > 기본 임계값
    assert autotrim.alpha_bbox(img) == (7, 7, 8, 8)


# --- auto_trim_file (파일→파일) ---


def test_auto_trim_crops_to_bbox_and_preserves_pixels(tmp_path: Path) -> None:
    src = _padded_png(tmp_path / "in.png", box=(10, 20, 60, 60))
    out = tmp_path / "out.png"

    result = autotrim.auto_trim_file(src, out)

    assert result.trimmed is True
    assert result.output_path == str(out)
    assert (result.width_px, result.height_px) == (50, 40)
    assert out.is_file()
    with Image.open(out) as saved:
        assert saved.mode == "RGBA"
        assert saved.size == (50, 40)
        assert saved.getpixel((0, 0)) == (10, 200, 30, 255)  # 크롭 원점 = bbox 좌상단
        assert saved.getpixel((49, 39)) == (10, 200, 30, 255)


def test_auto_trim_noop_when_no_margin(tmp_path: Path) -> None:
    """bbox가 캔버스 전체 — 원본 경로·치수 그대로, 출력 파일 없음."""
    src = _padded_png(tmp_path / "full.png", box=(0, 0, 100, 80))
    out = tmp_path / "out.png"

    result = autotrim.auto_trim_file(src, out)

    assert result.trimmed is False
    assert result.output_path == str(src)
    assert (result.width_px, result.height_px) == (100, 80)
    assert not out.exists()


def test_auto_trim_fully_transparent_keeps_original(tmp_path: Path) -> None:
    """보이는 픽셀 0개 — 에러가 아니라 원본 유지 no-op."""
    src = _padded_png(tmp_path / "empty.png", box=(0, 0, 0, 0))
    out = tmp_path / "out.png"

    result = autotrim.auto_trim_file(src, out)

    assert result.trimmed is False
    assert result.output_path == str(src)
    assert not out.exists()


def test_auto_trim_jpeg_without_alpha_is_noop(tmp_path: Path) -> None:
    """JPG — 알파 없는 포맷은 RGBA 강제 시 전면 불투명 → no-op."""
    src = tmp_path / "photo.jpg"
    Image.new("RGB", (40, 30), (120, 120, 120)).save(src, format="JPEG")
    out = tmp_path / "out.png"

    result = autotrim.auto_trim_file(src, out)

    assert result.trimmed is False
    assert result.output_path == str(src)
    assert not out.exists()


def test_auto_trim_residue_only_margin_still_trims(tmp_path: Path) -> None:
    """가장자리가 전부 알파 1~5 잔상 — 잔상은 투명 취급되므로 중심 픽셀만 남는다."""
    src = _padded_png(
        tmp_path / "residue.png",
        canvas=(60, 60),
        box=(20, 20, 40, 40),
        margin_alpha=4,
    )
    out = tmp_path / "out.png"

    result = autotrim.auto_trim_file(src, out)

    assert result.trimmed is True
    assert (result.width_px, result.height_px) == (20, 20)


def test_auto_trim_preserves_physical_dpi(tmp_path: Path) -> None:
    """pHYs DPI 원본 — 크롭 출력에 물리 DPI가 이어져야 한다(물리 크기 보존 임포트).

    PNG pHYs는 ppm 정수로 양자화되므로 dpi 왕복 오차 ±0.1을 허용한다.
    """
    src = _padded_png(tmp_path / "dpi.png", box=(10, 10, 50, 50), dpi=(500.0, 500.0))
    out = tmp_path / "out.png"

    autotrim.auto_trim_file(src, out)

    with Image.open(out) as saved:
        dpi = saved.info.get("dpi")
        assert isinstance(dpi, tuple) and len(dpi) == 2
        assert dpi[0] == pytest.approx(500.0, abs=0.1)
        assert dpi[1] == pytest.approx(500.0, abs=0.1)


def test_auto_trim_missing_input_raises(tmp_path: Path) -> None:
    with pytest.raises(autotrim.AutoTrimError, match="not found"):
        autotrim.auto_trim_file(tmp_path / "ghost.png", tmp_path / "out.png")


def test_auto_trim_invalid_threshold_raises(tmp_path: Path) -> None:
    src = _padded_png(tmp_path / "in.png")
    with pytest.raises(autotrim.AutoTrimError, match="alpha_threshold"):
        autotrim.auto_trim_file(src, tmp_path / "out.png", alpha_threshold=255)
    with pytest.raises(autotrim.AutoTrimError, match="alpha_threshold"):
        autotrim.auto_trim_file(src, tmp_path / "out.png", alpha_threshold=-1)
    with pytest.raises(autotrim.AutoTrimError, match="alpha_threshold"):
        autotrim.auto_trim_file(src, tmp_path / "out.png", alpha_threshold=True)  # bool 배제


def test_auto_trim_undecodable_file_raises(tmp_path: Path) -> None:
    src = tmp_path / "fake.png"
    src.write_bytes(b"not a png at all")
    with pytest.raises(autotrim.AutoTrimError, match="cannot decode"):
        autotrim.auto_trim_file(src, tmp_path / "out.png")
