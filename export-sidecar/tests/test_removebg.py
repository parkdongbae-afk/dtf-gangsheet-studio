"""removebg 배경 제거 파이프라인 검증 — v2.

모델 추론(수백 MB 가중치)에 의존하지 않는 3개 축만 단위 테스트한다:

- ``apply_dtf_defringe`` 순수 함수 — 알파 침식·RGB 불변·치수 보존
- ``get_session`` 세션 캐싱 — 모델명별 1회 생성 재사용(REMOVEBG.MD §5)
- 서버 ``remove_bg`` 디스패치 — 스텁 process_file으로 경로 계약·에러 코드 매핑

실제 추론 품질은 dev 모드 E2E(실 이미지 파이프)로 별도 검증한다.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from rembg.sessions import BaseSession

import removebg
import server


@pytest.fixture(autouse=True)
def clean_sessions() -> Iterator[None]:
    """모듈 세션 캐시 격리 — 테스트 간 스텁 세션 누출 방지."""
    removebg._sessions.clear()
    yield
    removebg._sessions.clear()


def _rgba(pixels: list[list[tuple[int, int, int, int]]]) -> Image.Image:
    return Image.fromarray(np.array(pixels, dtype="uint8"), "RGBA")


# --- apply_dtf_defringe (순수 함수 — 모델·rembg 의존 없음) ---


def test_defringe_preserves_solid_alpha_and_rgb() -> None:
    """불투명 단색 이미지 — 알파 전면 255면 침식 후에도 불변, RGB도 불변."""
    src = Image.new("RGBA", (16, 16), (200, 30, 40, 255))
    out = removebg.apply_dtf_defringe(src, erode_px=1)
    assert out.size == src.size
    assert out.mode == "RGBA"
    corner = out.getpixel((0, 0))
    assert corner == (200, 30, 40, 255)  # 침식은 경계 축소일 뿐 내부 불변


def test_defringe_erodes_alpha_boundary_only() -> None:
    """좌측 불투명·우측 투명 경계 — 경계 열의 알파만 0으로, RGB은 유지."""
    pixels = [
        [(10, 20, 30, 255) if x < 8 else (200, 210, 220, 0) for x in range(16)]
        for _ in range(16)
    ]
    src = _rgba(pixels)
    out = removebg.apply_dtf_defringe(src, erode_px=1)

    inner = out.getpixel((4, 8))
    boundary = out.getpixel((7, 8))
    assert isinstance(inner, tuple) and isinstance(boundary, tuple)
    assert inner[3] == 255  # 내부 — 불투명 유지
    assert boundary[3] == 0  # 경계 열 — 침식으로 투명화
    assert boundary[:3] == (10, 20, 30)  # RGB 채널은 불변


def test_defringe_zero_px_is_noop_shape() -> None:
    """erode_px=0 — 1x1 커널은 침식 효과 없음(치수·알파 보존)."""
    pixels = [[(5, 6, 7, 255) if x < 4 else (0, 0, 0, 0) for x in range(8)] for _ in range(8)]
    out = removebg.apply_dtf_defringe(_rgba(pixels), erode_px=0)
    assert out.size == (8, 8)
    opaque = out.getpixel((0, 0))
    assert isinstance(opaque, tuple) and opaque[3] == 255


# --- get_session 세션 캐싱 (REMOVEBG.MD §5) ---


def test_get_session_creates_once_per_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[str] = []

    def fake_new_session(model: str) -> BaseSession:
        created.append(model)
        return BaseSession.__new__(BaseSession)  # __init__ 우회 — 로딩 없는 캐싱 검증용 스텁

    monkeypatch.setattr("rembg.new_session", fake_new_session)

    first = removebg.get_session("stub-a")
    again = removebg.get_session("stub-a")
    other = removebg.get_session("stub-b")

    assert first is again  # 동일 모델은 세션 재사용
    assert first is not other
    assert created == ["stub-a", "stub-b"]  # new_session 호출 = 모델 수


def test_remove_background_uses_raw_mask_without_matting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """alpha_matting 미사용 회귀 — pymatting(OOM·속도 병목, 2026-09-03 실측)을
    끄고 모델 마스크를 직용한다. remove()는 정확히 1회, matting=False로 호출."""
    import io

    calls: list[bool] = []

    def fake_remove(
        _data: bytes, *, session: BaseSession, alpha_matting: bool, **_kw: object
    ) -> bytes:
        calls.append(alpha_matting)
        buffer = io.BytesIO()
        Image.new("RGBA", (8, 8), (9, 8, 7, 255)).save(buffer, format="PNG")
        return buffer.getvalue()

    monkeypatch.setattr("rembg.remove", fake_remove)

    result = removebg.remove_background_dtf(
        b"stub", session=BaseSession.__new__(BaseSession)
    )

    assert calls == [False]  # 마팅 없는 단일 경로
    assert result.width_px == 8 and result.height_px == 8


# --- 서버 warmup 디스패치 (예열 — 기본 모델 사전 로딩) ---


def test_warmup_loads_default_model_session(monkeypatch: pytest.MonkeyPatch) -> None:
    loaded: list[str] = []

    def fake_get_session(model: str) -> BaseSession:
        loaded.append(model)
        return BaseSession.__new__(BaseSession)

    monkeypatch.setattr(removebg, "get_session", fake_get_session)

    response = server.handle_message(_rpc("warmup", {}))

    assert response is not None
    assert "error" not in response
    assert response["result"] == {"status": "ready", "model": removebg.DEFAULT_MODEL}
    assert loaded == [removebg.DEFAULT_MODEL]


def test_warmup_without_params_uses_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        removebg, "get_session", lambda _model: BaseSession.__new__(BaseSession)
    )
    response = server.handle_message({"jsonrpc": "2.0", "id": 1, "method": "warmup"})
    assert response is not None
    assert "error" not in response


@pytest.mark.parametrize("params", ["not-object", {"model": ""}, {"model": 3}])
def test_warmup_invalid_params_maps_to_32602(params: object) -> None:
    response = server.handle_message(_rpc("warmup", params))
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INVALID_PARAMS


def test_warmup_model_load_failure_maps_to_32602(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(_model: str) -> BaseSession:
        raise RuntimeError("weights unavailable")

    monkeypatch.setattr(removebg, "get_session", boom)
    response = server.handle_message(_rpc("warmup", {}))
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INVALID_PARAMS
    assert "weights unavailable" in str(error["message"])


# --- 서버 remove_bg 디스패치 (경로 계약 — STDIO_GUIDE) ---


def _rpc(method: str, params: object, request_id: object = 1) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}


def _stub_process_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> dict[str, object]:
    """process_file 스텁 — 실제 모델 없이 계약(출력 파일+메타데이터)만 재현."""
    calls: dict[str, object] = {}

    def fake_process_file(
        input_path: str | Path,
        output_path: str | Path,
        model: str = removebg.DEFAULT_MODEL,
        defringe_px: int = removebg.DEFAULT_DEFRINGE_PX,
    ) -> removebg.RemoveBgResult:
        calls["input_path"] = str(input_path)
        calls["model"] = model
        calls["defringe_px"] = defringe_px
        Image.new("RGBA", (32, 16), (1, 2, 3, 255)).save(output_path)
        return removebg.RemoveBgResult(
            png=Path(output_path).read_bytes(), width_px=32, height_px=16
        )

    monkeypatch.setattr(removebg, "process_file", fake_process_file)
    return calls


def test_remove_bg_dispatches_and_returns_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _stub_process_file(monkeypatch, tmp_path)
    out = tmp_path / "cutout.png"
    params = {"input_path": str(tmp_path / "src.jpg"), "output_path": str(out)}

    response = server.handle_message(_rpc("remove_bg", params))
    assert response is not None
    result = response["result"]
    assert isinstance(result, dict)
    assert result["output_path"] == str(out)
    assert result["width_px"] == 32
    assert result["height_px"] == 16
    assert out.is_file()
    assert calls["input_path"] == str(tmp_path / "src.jpg")
    assert calls["model"] == removebg.DEFAULT_MODEL
    assert calls["defringe_px"] == removebg.DEFAULT_DEFRINGE_PX
    # 응답은 한 줄 NDJSON — 바이너리 유출 없음(STDIO_GUIDE)
    assert "\n" not in json.dumps(response, ensure_ascii=False)


def test_remove_bg_forwards_model_and_defringe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _stub_process_file(monkeypatch, tmp_path)
    params = {
        "input_path": str(tmp_path / "src.jpg"),
        "output_path": str(tmp_path / "o.png"),
        "model": "u2netp",
        "defringe_px": 2,
    }
    response = server.handle_message(_rpc("remove_bg", params))
    assert response is not None
    assert "error" not in response
    assert calls["model"] == "u2netp"
    assert calls["defringe_px"] == 2


def test_remove_bg_missing_input_maps_to_32602(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """파일 없음 — 스텁 없이 실제 process_file 경로의 입력 검증 확인."""
    params = {
        "input_path": str(tmp_path / "ghost.jpg"),
        "output_path": str(tmp_path / "o.png"),
    }
    response = server.handle_message(_rpc("remove_bg", params))
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INVALID_PARAMS
    assert "ghost.jpg" in str(error["message"])


@pytest.mark.parametrize(
    "params",
    [
        "not-object",
        {},
        {"input_path": "a.png"},  # output_path 누락
        {"input_path": "", "output_path": "b.png"},  # 빈 input
        {"input_path": "a.png", "output_path": "b.png", "defringe_px": -1},
        {"input_path": "a.png", "output_path": "b.png", "defringe_px": "1"},
        {"input_path": "a.png", "output_path": "b.png", "defringe_px": True},
        {"input_path": "a.png", "output_path": "b.png", "model": 3},
    ],
)
def test_remove_bg_invalid_params_maps_to_32602(params: object) -> None:
    response = server.handle_message(_rpc("remove_bg", params))
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INVALID_PARAMS


def test_remove_bg_runtime_failure_maps_to_32603(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_args: object, **_kwargs: object) -> removebg.RemoveBgResult:
        raise RuntimeError("onnx exploded")

    monkeypatch.setattr(removebg, "process_file", boom)
    params = {
        "input_path": str(tmp_path / "src.jpg"),
        "output_path": str(tmp_path / "o.png"),
    }
    response = server.handle_message(_rpc("remove_bg", params))
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INTERNAL_ERROR
    assert "RuntimeError" in str(error["message"])
