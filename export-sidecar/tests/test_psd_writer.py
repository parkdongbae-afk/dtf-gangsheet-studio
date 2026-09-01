"""psd_writer.write_psd 라운드트립 검증 — S1 세션 1 headless 게이트.

포토샵 수동 개봉(세션 2) 전 이 테스트가 전부 통과해야 한다.
``_raw_resolution_block``은 psd-tools 디코더와 무관하게 파일 원시
바이트에서 Image Resource 1005 블록을 직접 파싱해, 바이너리 레이아웃
(fixed-point 16.16, 16바이트) 자체를 검증한다 — exiftool Photoshop.pm
레이아웃(I 2H I 2H)과 대응.
"""

import struct
from collections.abc import Iterator
from pathlib import Path

import pytest
from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import ColorMode, Compression, Resource

import color
import psd_writer

CANVAS_SIZE = (500, 500)
SPIKE_LAYER_SHAPES = {"red": (120, 80), "blue": (200, 100), "yellow": (100, 100)}


def _solid_cmyk(size: tuple[int, int], rgb: tuple[int, int, int]) -> Image.Image:
    return color.rgb_to_cmyk(Image.new("RGB", size, rgb))


def _spike_layers() -> list[psd_writer.LayerSpec]:
    """3레이어 — 'red'는 캔버스 밖 음수 좌표(-50,-50) 배치."""
    return [
        psd_writer.LayerSpec(_solid_cmyk((120, 80), (255, 0, 0)), "red", top=-50, left=-50),
        psd_writer.LayerSpec(_solid_cmyk((200, 100), (0, 128, 255)), "blue", top=30, left=120),
        psd_writer.LayerSpec(_solid_cmyk((100, 100), (255, 255, 0)), "yellow", top=300, left=300),
    ]


@pytest.fixture
def spike_psd(tmp_path: Path) -> Iterator[Path]:
    path = tmp_path / "spike.psd"
    psd_writer.write_psd(path, CANVAS_SIZE, _spike_layers())
    yield path


def _open(psd_path: Path) -> PSDImage:
    return PSDImage.open(psd_path)


def _layer_by_name(psd: PSDImage, name: str):
    return next(layer for layer in psd if layer.name == name)


def _raw_resolution_block(data: bytes) -> tuple[int, int, int, int, int, int]:
    """원시 바이트에서 8BIM 1005 블록을 찾아 >IHHIHH 로 직접 디코딩."""
    pos = data.find(b"8BIM\x03\xed")
    assert pos >= 0, "ResolutionInfo(1005) 리소스 블록이 없음"
    name_len = data[pos + 6]
    padded_name = 1 + name_len + (1 + name_len) % 2  # 길이바이트+이름, 짝수 패딩
    body = pos + 6 + padded_name
    (block_len,) = struct.unpack(">I", data[body : body + 4])
    assert block_len == 16, f"ResolutionInfo 블록 길이 오류: {block_len} (기대 16)"
    return struct.unpack(">IHHIHH", data[body + 4 : body + 4 + 16])


def test_write_psd_roundtrip_color_mode_is_cmyk_4(spike_psd: Path) -> None:
    psd = _open(spike_psd)
    assert psd.color_mode == ColorMode.CMYK
    assert int(psd.color_mode) == 4  # 3(RGB) 아님 — CLAUDE.md §1-2
    assert (psd.width, psd.height) == CANVAS_SIZE
    assert psd.channels == 4  # 문서 채널 = C,M,Y,K


def test_write_psd_roundtrip_preserves_three_layers(spike_psd: Path) -> None:
    psd = _open(spike_psd)
    assert sorted(layer.name for layer in psd) == ["blue", "red", "yellow"]


def test_write_psd_roundtrip_preserves_negative_offsets(spike_psd: Path) -> None:
    psd = _open(spike_psd)
    red = _layer_by_name(psd, "red")
    assert (red.left, red.top) == (-50, -50)
    assert red.bbox == (-50, -50, -50 + 120, -50 + 80)  # (left, top, right, bottom)
    assert (red.width, red.height) == SPIKE_LAYER_SHAPES["red"]


def test_write_psd_cmyk_layers_have_five_channels(spike_psd: Path) -> None:
    # 투명(-1) + C,M,Y,K(0..3) = 5채널 — 알파 포함 카운트 오류 차단
    psd = _open(spike_psd)
    for layer in psd:
        ids = sorted(int(info.id) for info in layer._record.channel_info)
        assert ids == [-1, 0, 1, 2, 3], f"{layer.name} 채널 구성 오류: {ids}"


def test_write_psd_embeds_350dpi_raw_binary_block(spike_psd: Path) -> None:
    # psd-tools 무관 원시 바이트 검증 — 포토샵 개봉 전 바이너리 계약 확인
    h_res, h_unit, _, v_res, v_unit, _ = _raw_resolution_block(spike_psd.read_bytes())
    assert h_res / 0x10000 == pytest.approx(350.0)
    assert v_res / 0x10000 == pytest.approx(350.0)
    assert (h_unit, v_unit) == (1, 1)  # 1 = pixels/inch


def test_write_psd_roundtrip_resolution_info_via_psd_tools(spike_psd: Path) -> None:
    from psd_tools.psd.image_resources import ResoulutionInfo  # 업스트림 오타 클래스명

    psd = _open(spike_psd)
    info = psd.image_resources.get_data(Resource.RESOLUTION_INFO)
    assert isinstance(info, ResoulutionInfo)
    assert info.horizontal / 0x10000 == pytest.approx(350.0)
    assert info.vertical / 0x10000 == pytest.approx(350.0)


def test_write_psd_roundtrip_preserves_layer_pixels(spike_psd: Path) -> None:
    # CMYK 채널 반전 저장 규약이 정확히 왕복되는지 — 픽셀 단위 극값 검증
    psd = _open(spike_psd)
    decoded = _layer_by_name(psd, "red").topil()
    assert decoded is not None
    original = _solid_cmyk(SPIKE_LAYER_SHAPES["red"], (255, 0, 0))
    assert decoded.mode == "CMYK"
    assert decoded.size == original.size
    assert decoded.getpixel((0, 0)) == original.getpixel((0, 0)) == (0, 255, 255, 0)


def test_write_psd_rejects_canvas_over_psd_limit(tmp_path: Path) -> None:
    with pytest.raises(psd_writer.CanvasSizeError):
        psd_writer.write_psd(tmp_path / "over.psd", (30_001, 100), [])


def test_write_psd_rejects_non_cmyk_layer_image(tmp_path: Path) -> None:
    spec = psd_writer.LayerSpec(Image.new("RGB", (10, 10), (0, 0, 0)), "rgb_layer", 0, 0)
    with pytest.raises(psd_writer.NonCmykLayerError):
        psd_writer.write_psd(tmp_path / "bad.psd", (100, 100), [spec])


def test_write_psd_attaches_alpha_as_user_mask(tmp_path: Path) -> None:
    """LayerSpec.alpha → USER_LAYER_MASK(-2) 저장·라운드트립 (S6 세션 1).

    PIL CMYK는 알파를 담을 수 없어 psd-tools 공식 경로(픽셀 마스크)로
    저장한다 — DTF 백색 잉크 영역(알파) 보존의 핵심 계약.
    """
    alpha = Image.new("L", (60, 40), 255)
    alpha.putpixel((0, 0), 0)  # 좌상단 1픽셀만 투명
    spec = psd_writer.LayerSpec(
        _solid_cmyk((60, 40), (0, 128, 255)), "masked", top=5, left=5, alpha=alpha
    )
    path = tmp_path / "masked.psd"
    psd_writer.write_psd(path, (200, 200), [spec])

    psd = _open(path)
    layer = _layer_by_name(psd, "masked")
    ids = sorted(int(info.id) for info in layer._record.channel_info)
    assert ids == [-2, -1, 0, 1, 2, 3]  # 마스크(-2) + 투명(-1) + C,M,Y,K
    mask = layer.mask
    assert mask is not None
    assert (mask.left, mask.top) == (5, 5)  # 레이어와 정렬
    decoded = mask.topil()
    assert decoded is not None
    assert decoded.getpixel((0, 0)) == 0
    assert decoded.getpixel((30, 20)) == 255


def test_write_psd_rejects_alpha_size_and_mode_mismatch(tmp_path: Path) -> None:
    cmyk = _solid_cmyk((60, 40), (255, 0, 0))
    with pytest.raises(psd_writer.PsdWriterError, match="alpha"):
        bad_size = psd_writer.LayerSpec(cmyk, "x", 0, 0, alpha=Image.new("L", (10, 10)))
        psd_writer.write_psd(tmp_path / "bad.psd", (200, 200), [bad_size])
    with pytest.raises(psd_writer.PsdWriterError, match="alpha"):
        bad_mode = psd_writer.LayerSpec(cmyk, "x", 0, 0, alpha=Image.new("RGB", (60, 40)))
        psd_writer.write_psd(tmp_path / "bad.psd", (200, 200), [bad_mode])


def test_write_psd_solid_composite_path_for_huge_canvas(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """임계치 초과(2m) 경로 — 단색 프리뷰 주입으로 풀캔버스 합성 우회.

    실제 2m 캔버스를 그리면 테스트가 수 GB를 쓰므로 임계치를 0으로 낮려
    분기를 강제한다. 레이어 픽셀·해상도 리소스는 실합성 경로와 동일하게
    보존되어야 한다(Photoshop은 레이어로 재합성 — 프리뷰는 메타데이터).
    """
    monkeypatch.setattr(psd_writer, "PREVIEW_COMPOSITE_MAX_PX", 0)
    path = tmp_path / "huge.psd"
    psd_writer.write_psd(path, CANVAS_SIZE, _spike_layers())

    psd = _open(path)
    assert psd.color_mode == ColorMode.CMYK
    assert sorted(layer.name for layer in psd) == ["blue", "red", "yellow"]
    red = _layer_by_name(psd, "red")
    assert (red.left, red.top) == (-50, -50)
    decoded = red.topil()
    assert decoded is not None
    assert decoded.getpixel((0, 0)) == (0, 255, 255, 0)
    h_res, _, _, v_res, _, _ = _raw_resolution_block(path.read_bytes())
    assert h_res / 0x10000 == pytest.approx(350.0)
    assert v_res / 0x10000 == pytest.approx(350.0)
    # 단색 RLE 프리뷰가 실제 기록됐는지 — 압축 플래그와 데이터 존재
    assert psd._record.image_data.compression == Compression.RLE
    assert len(psd._record.image_data.data) > 0


def test_write_psd_real_composite_preview_roundtrip(tmp_path: Path) -> None:
    """호출자 합성 프리뷰 주입 — 반전 저장 후 psd-tools 읽기로 원색 복원(수 초 저장 경로)."""
    preview = _solid_cmyk((200, 120), (255, 0, 0))  # PIL 의미 빨강 CMYK
    path = tmp_path / "preview.psd"
    psd_writer.write_psd(path, (200, 120), _spike_layers()[:1], preview=preview)

    psd = _open(path)
    decoded = psd.topil()
    assert decoded is not None
    assert decoded.mode == "CMYK"
    # 프리뷰 전체가 빨강(0,255,255,0)으로 라운드트립 — 반전 저장 의미론 단정
    assert decoded.getpixel((5, 5)) == (0, 255, 255, 0)
    assert decoded.getpixel((150, 90)) == (0, 255, 255, 0)


def test_write_psd_rejects_non_cmyk_preview(tmp_path: Path) -> None:
    with pytest.raises(psd_writer.PsdWriterError, match="preview"):
        psd_writer.write_psd(
            tmp_path / "bad.psd", (100, 100), [], preview=Image.new("RGB", (100, 100))
        )
