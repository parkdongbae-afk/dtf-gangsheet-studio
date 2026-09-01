"""renderer 풀해상도 렌더링 검증 — S6 세션 1.

매니페스트 파싱·cm→px 수학·회전 방향(Konva 호환)·알파 마스크 분리를
실제 PSD 라운드트립으로 검증한다. 회전 방향 부정 시 편집기 화면과
내보내기 결과가 좌우로 뒤집히므로 비대칭 알파 픽셀로 방향까지 단정한다.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import ChannelID, ColorMode

import color
import renderer


@pytest.fixture
def red_png(tmp_path: Path) -> Iterator[Path]:
    """완전 불투명 빨강 PNG 400×200 — 알파 없는 경로(no-mask) 검증용."""
    path = tmp_path / "red.png"
    Image.new("RGB", (400, 200), (255, 0, 0)).save(path)
    yield path


@pytest.fixture
def half_alpha_png(tmp_path: Path) -> Iterator[Path]:
    """좌측 절반만 불투명한 비대칭 알파 PNG 200×100 — 회전 방향 검증용."""
    path = tmp_path / "half.png"
    image = Image.new("RGBA", (200, 100), (0, 128, 255, 0))
    for x in range(100):
        for y in range(100):
            image.putpixel((x, y), (0, 128, 255, 255))
    image.save(path)
    yield path


def _manifest_dict(
    output: Path,
    items: list[dict[str, object]],
    extra: dict[str, object] | None = None,
    **canvas: object,
) -> dict[str, object]:
    base: dict[str, object] = {"width_cm": 10, "height_m": 0.05, "dpi": 350}
    base.update(canvas)
    data: dict[str, object] = {"output_path": str(output), "canvas": base, "items": items}
    if extra is not None:
        data.update(extra)
    return data


# --- cm → px 수학 (TS Math.round와 동일 규칙) ---


@pytest.mark.parametrize(
    ("cm", "dpi", "expected_px"),
    [
        (50, 350, 6890),  # DTF 롤 폭
        (100, 350, 13780),  # 1m
        (200, 350, 27559),  # 2m — PSD 한계(30,000) 이내
        (15, 350, 2067),
        (1, 350, 138),
    ],
)
def test_cm_to_px_matches_editor_conversion(cm: float, dpi: int, expected_px: int) -> None:
    assert renderer.cm_to_px(cm, dpi) == expected_px


# --- 매니페스트 파싱 ---


def test_parse_manifest_defaults_and_fields(tmp_path: Path, red_png: Path) -> None:
    data = _manifest_dict(
        tmp_path / "out.psd",
        [{"src": str(red_png), "x_cm": 1, "y_cm": 2, "width_cm": 3, "height_cm": 4, "rotation": 90}],
    )
    manifest = renderer.parse_manifest(data)
    assert manifest.output_path == tmp_path / "out.psd"
    assert manifest.canvas.dpi == 350  # 생략 시 기본값
    assert manifest.canvas.width_cm == 10
    assert manifest.canvas.height_m == 0.05
    (item,) = manifest.items
    assert item.src == red_png
    assert (item.x_cm, item.y_cm, item.width_cm, item.height_cm, item.rotation) == (1, 2, 3, 4, 90)


def test_parse_manifest_rejects_missing_and_wrong_types(tmp_path: Path, red_png: Path) -> None:
    with pytest.raises(renderer.ManifestError, match="output_path"):
        renderer.parse_manifest({"canvas": {}, "items": []})
    with pytest.raises(renderer.ManifestError, match="canvas"):
        renderer.parse_manifest({"output_path": str(tmp_path / "o.psd"), "items": []})
    with pytest.raises(renderer.ManifestError, match="items"):
        renderer.parse_manifest({"output_path": str(tmp_path / "o.psd"), "canvas": {}})
    with pytest.raises(renderer.ManifestError, match="dpi"):
        bad = _manifest_dict(tmp_path / "o.psd", [], dpi="350")
        renderer.parse_manifest(bad)
    with pytest.raises(renderer.ManifestError, match="items"):
        bad_items = _manifest_dict(tmp_path / "o.psd", [{"src": "x", "x_cm": "1"}])
        renderer.parse_manifest(bad_items)


def test_parse_manifest_rejects_nonpositive_dimensions(tmp_path: Path, red_png: Path) -> None:
    with pytest.raises(renderer.ManifestError, match="width_cm"):
        renderer.parse_manifest(_manifest_dict(tmp_path / "o.psd", [], width_cm=0))
    with pytest.raises(renderer.ManifestError, match=r"width_cm must be > 0"):
        item = {"src": str(red_png), "x_cm": 0, "y_cm": 0, "width_cm": -1, "height_cm": 1, "rotation": 0}
        renderer.parse_manifest(_manifest_dict(tmp_path / "o.psd", [item]))


def test_parse_manifest_rejects_canvas_over_psd_limit(tmp_path: Path) -> None:
    # 3m(41,339px) — PSD 한계 초과, 오류 메시지에 2m 분할 안내 포함
    with pytest.raises(renderer.ManifestError, match="2m"):
        renderer.parse_manifest(_manifest_dict(tmp_path / "o.psd", [], height_m=3))


def test_parse_manifest_format_and_flatten(tmp_path: Path, red_png: Path) -> None:
    item = {"src": str(red_png), "x_cm": 0, "y_cm": 0, "width_cm": 1, "height_cm": 1, "rotation": 0}
    defaults = renderer.parse_manifest(_manifest_dict(tmp_path / "o.psd", [item]))
    assert defaults.fmt == "psd"  # 생략 시 기본값
    assert defaults.flatten is False

    png = renderer.parse_manifest(
        _manifest_dict(tmp_path / "o.png", [item], extra={"format": "png", "flatten": True})
    )
    assert png.fmt == "png"
    assert png.flatten is True


def test_parse_manifest_rejects_bad_format_and_flatten(tmp_path: Path, red_png: Path) -> None:
    item = {"src": str(red_png), "x_cm": 0, "y_cm": 0, "width_cm": 1, "height_cm": 1, "rotation": 0}
    with pytest.raises(renderer.ManifestError, match="format"):
        renderer.parse_manifest(_manifest_dict(tmp_path / "o.psd", [item], extra={"format": "gif"}))
    with pytest.raises(renderer.ManifestError, match="format"):
        renderer.parse_manifest(_manifest_dict(tmp_path / "o.psd", [item], extra={"format": 3}))
    with pytest.raises(renderer.ManifestError, match="flatten"):
        renderer.parse_manifest(_manifest_dict(tmp_path / "o.psd", [item], extra={"flatten": "yes"}))


# --- 렌더: 배치·치수·픽셀 ---


def test_render_manifest_end_to_end_placement(tmp_path: Path, red_png: Path) -> None:
    out = tmp_path / "out.psd"
    manifest = renderer.parse_manifest(
        _manifest_dict(
            out,
            [{"src": str(red_png), "x_cm": 1, "y_cm": 1, "width_cm": 2, "height_cm": 1, "rotation": 0}],
        )
    )
    result = renderer.render_manifest(manifest)

    assert result.output_path == out and out.is_file()
    assert (result.width_px, result.height_px) == (1378, 689)  # 10cm×5cm @350
    assert result.layer_count == 1

    psd = PSDImage.open(out)
    assert psd.color_mode == ColorMode.CMYK
    (layer,) = list(psd)
    assert layer.name == "red 1"
    assert layer.bbox == (138, 138, 138 + 276, 138 + 138)  # (left, top, right, bottom)
    decoded = layer.topil()
    assert decoded is not None
    assert decoded.getpixel((100, 50)) == color.rgb_to_cmyk(
        Image.new("RGB", (1, 1), (255, 0, 0))
    ).getpixel((0, 0))


def test_render_manifest_layer_order_matches_items(tmp_path: Path, red_png: Path) -> None:
    items = [
        {"src": str(red_png), "x_cm": 0, "y_cm": 0, "width_cm": 1, "height_cm": 1, "rotation": 0},
        {"src": str(red_png), "x_cm": 2, "y_cm": 0, "width_cm": 1, "height_cm": 1, "rotation": 0},
    ]
    manifest = renderer.parse_manifest(_manifest_dict(tmp_path / "out.psd", items))
    renderer.render_manifest(manifest)
    psd = PSDImage.open(tmp_path / "out.psd")
    names = [layer.name for layer in psd]
    assert names == ["red 1", "red 2"]  # 먼저 온 항목 = 아래 레이어(psd[0])


def test_render_manifest_missing_src_error(tmp_path: Path) -> None:
    item = {
        "src": str(tmp_path / "nope.png"),
        "x_cm": 0,
        "y_cm": 0,
        "width_cm": 1,
        "height_cm": 1,
        "rotation": 0,
    }
    manifest = renderer.parse_manifest(_manifest_dict(tmp_path / "o.psd", [item]))
    with pytest.raises(renderer.ManifestError, match="nope.png"):
        renderer.render_manifest(manifest)


# --- 렌더: 회전 방향 + 알파 마스크 ---


def test_render_rotation_90_clockwise_matches_konva(tmp_path: Path, half_alpha_png: Path) -> None:
    """rotation=90(시계 방향)이면 좌측 절반(불투명)은 상단 절반이 되고
    바운딩 박스는 치수가 뒤바뀐다 — 편집기 화면과 출력물의 방향 일치 단정."""
    out = tmp_path / "rot.psd"
    manifest = renderer.parse_manifest(
        _manifest_dict(
            out,
            [
                {
                    "src": str(half_alpha_png),
                    "x_cm": 4,
                    "y_cm": 3,
                    "width_cm": 2,
                    "height_cm": 1,
                    "rotation": 90,
                }
            ],
        )
    )
    renderer.render_manifest(manifest)

    psd = PSDImage.open(out)
    (layer,) = list(psd)
    # 배치: 중심 (551+138, 413+69), 회전 후 치수 (138,276) → 좌상단 (620, 344)
    assert (layer.width, layer.height) == (138, 276)
    assert layer.bbox == (620, 344, 620 + 138, 344 + 276)

    ids = sorted(int(info.id) for info in layer._record.channel_info)
    assert ids == [-2, -1, 0, 1, 2, 3]  # USER_LAYER_MASK(-2) 포함 = 알파 보존
    assert layer.mask is not None
    mask = layer.mask.topil()
    assert mask is not None
    assert mask.size == (138, 276)
    assert mask.getpixel((69, 10)) == 255  # 회전 후 상단 = 원본 좌측 절반 → 불투명
    assert mask.getpixel((69, 270)) == 0  # 하단 = 원본 우측 절반 → 투명(백색 잉크 없음)


def test_render_opaque_image_has_no_mask(tmp_path: Path, red_png: Path) -> None:
    manifest = renderer.parse_manifest(
        _manifest_dict(
            tmp_path / "flat.psd",
            [
                {
                    "src": str(red_png),
                    "x_cm": 0,
                    "y_cm": 0,
                    "width_cm": 2,
                    "height_cm": 1,
                    "rotation": 0,
                }
            ],
        )
    )
    renderer.render_manifest(manifest)
    psd = PSDImage.open(tmp_path / "flat.psd")
    (layer,) = list(psd)
    ids = sorted(int(info.id) for info in layer._record.channel_info)
    assert ids == [-1, 0, 1, 2, 3]  # 마스크 없음 — 완전 불투명은 -1 채널만으로 충분
    assert not any(info.id == ChannelID.USER_LAYER_MASK for info in layer._record.channel_info)


# --- PNG 출력 (F9 — 알파 보존) ---


def test_render_png_preserves_alpha_and_dpi(tmp_path: Path, half_alpha_png: Path) -> None:
    """PNG 검수 출력 — 합성 알파(백색 잉크 영역)·RGB 색·DPI 메타데이터 보존."""
    out = tmp_path / "out.png"
    manifest = renderer.parse_manifest(
        _manifest_dict(
            out,
            [
                {
                    "src": str(half_alpha_png),
                    "x_cm": 1,
                    "y_cm": 1,
                    "width_cm": 2,
                    "height_cm": 1,
                    "rotation": 0,
                }
            ],
            extra={"format": "png"},
        )
    )
    result = renderer.render_manifest(manifest)

    assert result.output_path == out and out.is_file()
    assert (result.width_px, result.height_px) == (1378, 689)
    assert result.layer_count == 1  # PNG은 평면 이미지 1장

    with Image.open(out) as loaded:
        assert loaded.mode == "RGBA"
        assert loaded.size == (1378, 689)
        dpi_x, dpi_y = loaded.info["dpi"]
        assert abs(dpi_x - 350) < 0.1 and abs(dpi_y - 350) < 0.1  # pHYs 왕복 오차
        # 배치 (138,138) 276×138 — 좌측 절반 불투명·RGB 색상 보존, 우측·바탕 투명
        assert loaded.getpixel((138 + 50, 138 + 50)) == (0, 128, 255, 255)
        assert loaded.getpixel((138 + 220, 138 + 50)) == (0, 0, 0, 0)
        assert loaded.getpixel((10, 10)) == (0, 0, 0, 0)


# --- PSD 병합 옵션 (F8 — 단일 인쇄 레이어) ---


def test_render_flatten_psd_single_cmyk_layer(tmp_path: Path, half_alpha_png: Path) -> None:
    out = tmp_path / "merged.psd"
    manifest = renderer.parse_manifest(
        _manifest_dict(
            out,
            [
                {
                    "src": str(half_alpha_png),
                    "x_cm": 1,
                    "y_cm": 1,
                    "width_cm": 2,
                    "height_cm": 1,
                    "rotation": 0,
                }
            ],
            extra={"flatten": True},
        )
    )
    result = renderer.render_manifest(manifest)

    assert result.layer_count == 1
    psd = PSDImage.open(out)
    assert psd.color_mode == ColorMode.CMYK
    (layer,) = list(psd)
    assert layer.name == renderer.MERGED_LAYER_NAME
    assert layer.bbox == (0, 0, 1378, 689)  # 캔버스 전체를 덮는 단일 레이어
    # 캔버스에 투명 영역이 있으므로 합성 알파가 전체 크기 마스크로 보존된다
    assert layer.mask is not None
    mask = layer.mask.topil()
    assert mask is not None
    assert mask.size == (1378, 689)
    assert mask.getpixel((138 + 50, 138 + 50)) == 255
    assert mask.getpixel((10, 10)) == 0


# --- 진행 보고 (progress 콜백) ---


def test_render_progress_callback_order(tmp_path: Path, red_png: Path) -> None:
    item = {"src": str(red_png), "x_cm": 0, "y_cm": 0, "width_cm": 1, "height_cm": 1, "rotation": 0}
    manifest = renderer.parse_manifest(
        _manifest_dict(tmp_path / "prog.psd", [item, dict(item)])
    )
    events: list[tuple[str, int, int]] = []
    renderer.render_manifest(manifest, on_progress=lambda *e: events.append(e))
    assert events == [
        ("items", 1, 2),
        ("items", 2, 2),
        ("write", 2, 2),
    ]


def test_render_layered_psd_has_real_composite_preview(tmp_path: Path, red_png: Path) -> None:
    """레이어 보존 경로(≤1m) — PIL 합성 프리뷰가 백색 배경+항목 색으로 기록된다."""
    manifest = renderer.parse_manifest(
        _manifest_dict(
            tmp_path / "preview.psd",
            [
                {
                    "src": str(red_png),
                    "x_cm": 1,
                    "y_cm": 1,
                    "width_cm": 2,
                    "height_cm": 1,
                    "rotation": 0,
                }
            ],
        )
    )
    renderer.render_manifest(manifest)

    psd = PSDImage.open(tmp_path / "preview.psd")
    preview = psd.topil()
    assert preview is not None
    # 항목(138..414 × 138..276) 안은 빨강 CMYK, 바깥은 흰 배경(0,0,0,0)
    assert preview.getpixel((200, 200)) == (0, 255, 255, 0)
    assert preview.getpixel((10, 10)) == (0, 0, 0, 0)
