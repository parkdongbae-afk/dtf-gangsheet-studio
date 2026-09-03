"""upscale 파이프라인 검증 — 타일 레이아웃·페더 블렌딩·리사이즈·DPI 임베드·서버 계약.

실모델 추론(64MB 가중치) 없이 검증 가능한 경로만 단위 테스트한다:

- ``plan_tiles`` — 오버랩 그리드·가장자리 흡수·입력 검증
- ``tile_weights`` — 내부 변 램프·바깥변 1 유지·모서리 곱 페이드
- ``upscale_rgb`` — 상수 이미지 블렌딩 불변(타일 경계 무결성) — 모델 x4를
  nearest 복제로 흉내
- ``resize_exact`` / ``encode_image`` — 치수 보정·pHYs/JFIF DPI 왕복·JPEG 백색 합성
- ``process_file`` — 리샘플 체인(모델 없음) E2E·COVER 크롭·CONTAIN 여백·체크포인트
- ``server.handle_message`` — upscale 디스패치·progress 알림·파라미터 검증
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

import server
import upscale

# --- plan_tiles (타일 그리드) ---


def test_plan_tiles_single_tile_when_small() -> None:
    assert upscale.plan_tiles(200, 100, 512, 32) == [(0, 0, 200, 100)]


def test_plan_tiles_overlap_stride_and_edge_absorption() -> None:
    # 폭 1200, 타일 512, 오버랩 32: x=0(512) → 480(512) → 960(240 흡수)
    tiles = upscale.plan_tiles(1200, 100, 512, 32)
    xs = [(tx, tw) for tx, ty, tw, th in tiles]
    assert xs == [(0, 512), (480, 512), (960, 240)]
    # 마지막 타일이 캔버스 끝을 정확히 덮는다
    assert xs[-1][0] + xs[-1][1] == 1200
    # 인접 타일 겹침이 오버랩 폭과 일치한다
    assert xs[1][0] - (xs[0][0] + xs[0][1]) == -32


def test_plan_tiles_rejects_overlap_ge_half_tile() -> None:
    with pytest.raises(upscale.UpscaleError, match="2x overlap"):
        upscale.plan_tiles(500, 500, 64, 32)
    with pytest.raises(upscale.UpscaleError, match="positive"):
        upscale.plan_tiles(0, 100, 512, 32)


# --- tile_weights (페더 가중) ---


def test_tile_weights_outer_edges_stay_one() -> None:
    weights = upscale.tile_weights(64, 64, 16, interior_x=False, interior_y=False)
    assert weights.shape == (64, 64)
    assert weights.min() == 1.0


def test_tile_weights_interior_edges_ramp_from_zero() -> None:
    weights = upscale.tile_weights(64, 64, 16, interior_x=True, interior_y=True)
    assert weights[32, 0] == pytest.approx(0.0)
    assert weights[32, 15] == pytest.approx(1.0)  # 16px 램프: 겹침 끝에서 완전 가중
    assert weights[32, 16] == 1.0
    assert weights[0, 32] == pytest.approx(0.0)
    # 모서리는 두 램프의 곱
    assert weights[0, 0] == pytest.approx(0.0)
    assert weights[63, 63] == pytest.approx(0.0)


# --- upscale_rgb (타일 블렌딩 — 모의 x4) ---


class _ReplicaSession:
    """모델 대용 — nearest 4배 복제. _run_model_tile과 동일 계약."""

    def get_inputs(self) -> list[Any]:
        class _Input:
            name = "input"

        return [_Input()]

    def run(self, _names: Any, feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        chw = feeds["input"][0]  # (3, h, w) float
        up = np.repeat(np.repeat(chw, upscale.MODEL_SCALE, axis=1), upscale.MODEL_SCALE, axis=2)
        return [up[None]]


def test_upscale_rgb_constant_image_survives_tiled_blending() -> None:
    """상수 이미지는 어떤 블렌딩 가중에서도 상수여야 한다 — 이음새 무결성 증명."""
    rgb = np.full((300, 300, 3), 120, dtype=np.uint8)
    out = upscale.upscale_rgb(rgb, _ReplicaSession(), tile=64, overlap=16, force_tiling=True)
    assert out.shape == (300 * 4, 300 * 4, 3)
    assert out.min() == 120 and out.max() == 120


def test_upscale_rgb_seam_matches_untiled(monkeypatch: pytest.MonkeyPatch) -> None:
    """타일 처리 결과가 단일 처리(nearest x4)와 픽셀 단위로 일치 — 페더 블렌딩 검증."""
    rng = np.random.default_rng(42)
    rgb = rng.integers(0, 256, (128, 128, 3), dtype=np.uint8)
    tiled = upscale.upscale_rgb(rgb, _ReplicaSession(), tile=48, overlap=12, force_tiling=True)
    direct = upscale._run_model_tile(_ReplicaSession(), rgb)
    assert np.array_equal(tiled, direct)


# --- resize_exact / encode_image ---


def test_resize_exact_noop_and_correction() -> None:
    rgba = np.zeros((10, 20, 4), dtype=np.uint8)
    assert upscale.resize_exact(rgba, 20, 10).shape == (10, 20, 4)
    assert upscale.resize_exact(rgba, 40, 20).shape == (20, 40, 4)
    assert upscale.resize_exact(rgba, 10, 5).shape == (5, 10, 4)
    with pytest.raises(upscale.UpscaleError):
        upscale.resize_exact(rgba, 0, 5)


def test_encode_png_embeds_phys_dpi() -> None:
    rgba = np.full((8, 8, 4), (10, 20, 30, 255), dtype=np.uint8)
    payload = upscale.encode_image(rgba, "png", 1.0, 300, True)
    with Image.open(io.BytesIO(payload)) as img:
        assert img.info.get("dpi") == pytest.approx((300.0, 300.0), abs=1.0)


def test_encode_png_without_dpi_metadata() -> None:
    rgba = np.zeros((8, 8, 4), dtype=np.uint8)
    payload = upscale.encode_image(rgba, "png", 1.0, 300, False)
    with Image.open(io.BytesIO(payload)) as img:
        assert "dpi" not in img.info


def test_encode_jpeg_composites_alpha_on_white() -> None:
    rgba = np.zeros((8, 16, 4), dtype=np.uint8)
    rgba[..., 0] = 255  # 빨강
    rgba[..., 3] = 128  # 반투명 → 백색 합성 시 연한 분홍
    payload = upscale.encode_image(rgba, "jpeg", 0.95, 300, True)
    with Image.open(io.BytesIO(payload)) as img:
        assert img.mode == "RGB"
        assert img.info.get("dpi") == pytest.approx((300.0, 300.0), abs=1.0)
        center = img.getpixel((8, 4))
        # 빨강 255 @ 알파 128 + 백색 배경 → R≈255, G/B≈127 (반쯤 섞인 분홍)
        assert center[0] > 200
        assert center[1] == pytest.approx(127, abs=6)
        assert center[2] == pytest.approx(127, abs=6)


def test_encode_webp_ignores_dpi() -> None:
    rgba = np.zeros((8, 8, 4), dtype=np.uint8)
    payload = upscale.encode_image(rgba, "webp", 0.9, 300, True)
    assert payload[:4] == b"RIFF"


# --- process_file (체인 오케스트레이션 — 모델 없는 경로 + 모의 세션) ---


def _write_png(path: Path, size: tuple[int, int], color=(30, 60, 90, 255)) -> Path:
    arr = np.zeros((size[1], size[0], 4), dtype=np.uint8)
    arr[..., :4] = color
    Image.fromarray(arr, "RGBA").save(path)
    return path


def test_process_file_resample_downscale_chain(tmp_path: Path) -> None:
    """총 배율 ≤ 1.5 체인 — 모델 로딩 없이 리샘플만으로 종단 처리된다."""
    src = _write_png(tmp_path / "in.png", (100, 80))
    events: list[tuple[str, int, int, int, int]] = []
    result = upscale.process_file(
        src,
        tmp_path / "out.png",
        chain=[0.5],
        target_w=50,
        target_h=40,
        dpi=300,
        sharpen=0.0,
        on_progress=lambda *ev: events.append(ev),
    )
    assert (result.width_px, result.height_px) == (50, 40)
    assert result.steps[0].out_w == 50
    with Image.open(tmp_path / "out.png") as img:
        assert img.size == (50, 40)
        assert img.info.get("dpi") == pytest.approx((300.0, 300.0), abs=1.0)
    assert any(stage == "step" for stage, *_ in events)
    assert events[-1][0] == "encode"


def test_process_file_ai_chain_with_mock_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src = _write_png(tmp_path / "in.png", (32, 32))
    monkeypatch.setattr(upscale, "get_session", lambda _model: _ReplicaSession())
    result = upscale.process_file(
        src,
        tmp_path / "out.png",
        chain=[2.0],
        target_w=64,
        target_h=64,
        tile=16,  # 강제 타일링 — 32×4=128 > 임계 무관, 타일 경로 검증
        overlap=4,
        dpi=300,
        sharpen=0.0,
    )
    assert (result.width_px, result.height_px) == (64, 64)
    # 타일 강제 + nearest x4 → x4 후 2배로 축소 보정된 치수
    assert result.steps[0].out_w == 64


def test_process_file_cover_crop_and_contain_pad(tmp_path: Path) -> None:
    src = _write_png(tmp_path / "in.png", (100, 80), color=(255, 0, 0, 255))
    cover = upscale.process_file(
        src, tmp_path / "cover.png", [0.5], 40, 40, crop=(10, 0, 80, 80), dpi=300, sharpen=0.0
    )
    assert (cover.width_px, cover.height_px) == (40, 40)

    contain = upscale.process_file(
        src,
        tmp_path / "contain.png",
        [0.5],
        50,
        60,
        fit_mode="CONTAIN",
        dpi=300,
        sharpen=0.0,
    )
    with Image.open(tmp_path / "contain.png") as img:
        arr = np.asarray(img)
    # 50×60 캔버스에 40×40(정사각) 콘텐츠가 중앙에, 위아래 여백은 투명
    assert arr[0, 25, 3] == 0  # 상단 여백
    assert arr[30, 25, 3] == 255  # 중앙 콘텐츠
    assert (contain.width_px, contain.height_px) == (50, 60)


def test_process_file_writes_checkpoints(tmp_path: Path) -> None:
    src = _write_png(tmp_path / "in.png", (40, 40))
    upscale.process_file(
        src,
        tmp_path / "out.png",
        [0.5, 0.5],
        20,
        20,
        checkpoint_dir=tmp_path / "ck",
        dpi=300,
        sharpen=0.0,
    )
    assert (tmp_path / "ck" / "step1.png").is_file()
    assert (tmp_path / "ck" / "step2.png").is_file()


def test_process_file_validates_inputs(tmp_path: Path) -> None:
    src = _write_png(tmp_path / "in.png", (10, 10))
    with pytest.raises(upscale.UpscaleError, match="not found"):
        upscale.process_file(tmp_path / "nope.png", tmp_path / "o.png", [2], 20, 20)
    with pytest.raises(upscale.UpscaleError, match="chain"):
        upscale.process_file(src, tmp_path / "o.png", [], 20, 20)
    with pytest.raises(upscale.UpscaleError, match="format"):
        upscale.process_file(src, tmp_path / "o.png", [2], 20, 20, fmt="gif")  # type: ignore[arg-type]
    with pytest.raises(upscale.UpscaleError, match="bounds"):
        upscale.process_file(src, tmp_path / "o.png", [2], 20, 20, crop=(0, 0, 999, 999))
    with pytest.raises(upscale.UpscaleError, match="dpi"):
        upscale.process_file(src, tmp_path / "o.png", [2], 20, 20, dpi=9999)
    with pytest.raises(upscale.UpscaleError, match="model"):
        upscale.process_file(src, tmp_path / "o.png", [2], 20, 20, model="nope")
    with pytest.raises(upscale.UpscaleError, match="skip_steps"):
        upscale.process_file(src, tmp_path / "o.png", [2, 2], 40, 40, skip_steps=5)
    with pytest.raises(upscale.UpscaleError, match="resume checkpoint"):
        upscale.process_file(
            src, tmp_path / "o.png", [2, 2], 40, 40, skip_steps=1,
            resume_from=tmp_path / "missing.png",
        )


def test_process_file_resume_from_checkpoint(tmp_path: Path) -> None:
    """재개(§5.3) — 전체 실행 [0.5, 0.5] 결과와 1스텝 재개 결과가 동일해야 한다."""
    src = _write_png(tmp_path / "in.png", (100, 80))
    ck = tmp_path / "ck"
    full = upscale.process_file(
        src, tmp_path / "full.png", [0.5, 0.5], 50, 40,
        checkpoint_dir=ck, dpi=300, sharpen=0.0,
    )
    assert len(full.steps) == 2

    events: list[tuple[str, int, int]] = []
    resumed = upscale.process_file(
        src, tmp_path / "resumed.png", [0.5, 0.5], 50, 40,
        checkpoint_dir=ck, dpi=300, sharpen=0.0,
        resume_from=ck / "step1.png", skip_steps=1,
        on_progress=lambda stage, step, total, cur, tot: events.append((stage, step, total)),
    )
    # 실행된 스텝은 마지막 하나뿐 — 응답 records는 실행분만 담는다
    assert len(resumed.steps) == 1
    assert resumed.steps[0].out_w == full.steps[1].out_w
    with Image.open(tmp_path / "full.png") as a, Image.open(tmp_path / "resumed.png") as b:
        assert a.size == b.size == (50, 40)
    # 진행 알림 번호는 전체 체인 기준(2/2)으로 이어진다
    assert ("step", 2, 2) in events


def test_process_file_anime_model_alias_mapping() -> None:
    """엔진 별칭 → 모델 파일 매핑 — 사전 검증만(실추론은 실모델 E2E에서)"""
    assert upscale.ENGINE_ALIASES["anime"] == "RealESR-AnimeVideo-x4"
    assert upscale.ENGINE_ALIASES["general"] == upscale.DEFAULT_MODEL
    assert set(upscale.ENGINE_ALIASES.values()) <= set(upscale.MODEL_URLS)


def test_load_rgba_applies_exif_orientation(tmp_path: Path) -> None:
    """Orientation 6(90도 회전) JPEG — 로드 시 치수가 회전 반영된다(§6.3)."""
    arr = np.zeros((20, 10, 3), dtype=np.uint8)
    arr[..., 0] = 255
    img = Image.fromarray(arr, "RGB")
    exif = Image.Exif()
    exif[274] = 6  # Orientation
    img.save(tmp_path / "rot.jpg", exif=exif)
    rgba = upscale.load_rgba(tmp_path / "rot.jpg")
    assert rgba.shape[1] == 20 and rgba.shape[0] == 10  # 10×20 → 20×10


# --- server.py 계약 (디스패치·알림·검증) ---


def test_server_dispatches_upscale_and_emits_progress(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src = _write_png(tmp_path / "in.png", (10, 10))
    captured: list[dict[str, object]] = []

    def notifier(params: dict[str, object]) -> None:
        captured.append(params)

    def fake_process(*args: Any, **kwargs: Any) -> upscale.UpscaleResult:
        progress = kwargs.get("on_progress")
        if progress is not None:
            progress("step", 1, 1, 1, 1)
        return upscale.UpscaleResult(
            output_path=str(tmp_path / "out.png"),
            width_px=20,
            height_px=20,
            duration_ms=5,
            steps=(upscale.StepRecord(scale=2.0, out_w=20, out_h=20, ms=5),),
        )

    monkeypatch.setattr(upscale, "process_file", fake_process)
    response = server.handle_message(
        {
            "jsonrpc": "2.0",
            "id": 7,
            "method": "upscale",
            "params": {
                "input_path": str(src),
                "output_path": str(tmp_path / "out.png"),
                "chain": [2.0],
                "target_w": 20,
                "target_h": 20,
            },
        },
        notifier,
    )
    assert response is not None
    result = response["result"]  # type: ignore[index]
    assert result["width_px"] == 20
    assert result["steps"][0]["scale"] == 2.0
    assert captured and captured[0]["stage"] == "step"


def test_server_upscale_rejects_bad_params() -> None:
    response = server.handle_message(
        {"jsonrpc": "2.0", "id": 1, "method": "upscale", "params": {"chain": "nope"}}
    )
    assert response is not None
    assert response["error"]["code"] == -32602  # type: ignore[index]
