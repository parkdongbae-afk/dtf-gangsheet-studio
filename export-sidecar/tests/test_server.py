"""server NDJSON JSON-RPC 프로토콜 검증 — S6 세션 1.

디스패치(순수 호출)와 serve 루프(프레이밍)를 분리 검증한다.
STDIO_GUIDE 계약: 베어 매니페스트 원샷·에러 코드 매핑·알림 무응답·
shutdown 정지·파손 JSON 라인 무서비스 응답.
"""

import io
import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from PIL import Image

import renderer
import server


@pytest.fixture
def sample_png(tmp_path: Path) -> Iterator[Path]:
    path = tmp_path / "item.png"
    Image.new("RGBA", (64, 32), (10, 200, 30, 255)).save(path)
    yield path


def _manifest(output: Path, src: Path) -> dict[str, object]:
    return {
        "output_path": str(output),
        "canvas": {"width_cm": 5, "height_m": 0.05, "dpi": 350},
        "items": [
            {"src": str(src), "x_cm": 0.5, "y_cm": 0.5, "width_cm": 1, "height_cm": 0.5, "rotation": 0}
        ],
    }


def _rpc(method: str, params: object | None = None, request_id: object = 1) -> dict[str, object]:
    message: dict[str, object] = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        message["params"] = params
    return message


# --- 디스패치 ---


def test_ping_returns_protocol_and_version() -> None:
    response = server.handle_message(_rpc("ping"))
    assert response is not None
    assert response["id"] == 1
    result = response["result"]
    assert isinstance(result, dict)
    assert result["name"] == server.SIDECAR_NAME
    assert result["protocol"] == server.PROTOCOL_VERSION
    assert result["version"] == server.__version__


def test_render_returns_metadata_only_no_binary(tmp_path: Path, sample_png: Path) -> None:
    out = tmp_path / "export.psd"
    response = server.handle_message(_rpc("render", _manifest(out, sample_png)))
    assert response is not None
    result = response["result"]
    assert isinstance(result, dict)
    assert result["output_path"] == str(out)
    assert result["width_px"] == renderer.cm_to_px(5, 350)
    assert result["height_px"] == renderer.cm_to_px(5, 350)
    assert result["layer_count"] == 1
    assert isinstance(result["duration_ms"], int)
    assert out.is_file()
    # 응답은 반드시 한 줄 NDJSON으로 직렬화 가능해야 한다(경로·메타데이터만)
    assert "\n" not in json.dumps(response, ensure_ascii=False)


def test_render_invalid_params_maps_to_32602(tmp_path: Path) -> None:
    response = server.handle_message(_rpc("render", {"items": []}))  # 스키마 위반
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INVALID_PARAMS
    assert "canvas" in str(error["message"])


def test_render_missing_src_maps_to_32602(tmp_path: Path) -> None:
    bad = _manifest(tmp_path / "o.psd", tmp_path / "ghost.png")
    response = server.handle_message(_rpc("render", bad))
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INVALID_PARAMS


def test_unknown_method_maps_to_32601() -> None:
    response = server.handle_message(_rpc("nope"))
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.METHOD_NOT_FOUND


def test_internal_error_maps_to_32603(
    tmp_path: Path, sample_png: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(
        manifest: renderer.Manifest, on_progress: object = None
    ) -> renderer.RenderResult:
        raise RuntimeError("disk exploded")

    monkeypatch.setattr(renderer, "render_manifest", boom)
    response = server.handle_message(_rpc("render", _manifest(tmp_path / "o.psd", sample_png)))
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INTERNAL_ERROR
    assert "RuntimeError" in str(error["message"])


def test_bare_manifest_one_shot_mode(tmp_path: Path, sample_png: Path) -> None:
    """STDIO_GUIDE CLI 검증 경로 — method 없이 매니페스트만 밀어 넣기."""
    out = tmp_path / "bare.psd"
    response = server.handle_message(_manifest(out, sample_png))
    assert response is not None
    assert response["id"] is None
    result = response["result"]
    assert isinstance(result, dict)
    assert result["output_path"] == str(out)
    assert out.is_file()


def test_notification_gets_no_response() -> None:
    assert server.handle_message({"jsonrpc": "2.0", "method": "ping"}) is None


def test_notification_error_does_not_raise(tmp_path: Path) -> None:
    bad = _manifest(tmp_path / "o.psd", tmp_path / "ghost.png")
    assert server.handle_message({"jsonrpc": "2.0", "method": "render", "params": bad}) is None


def test_non_object_message_rejected() -> None:
    response = server.handle_message([1, 2, 3])
    assert response is not None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INVALID_REQUEST


# --- serve 루프(NDJSON 프레이밍) ---


def test_serve_frames_each_response_per_line(tmp_path: Path, sample_png: Path) -> None:
    out = tmp_path / "loop.psd"
    lines = [
        "not-json",  # 파손 라인 → -32700
        "",  # 빈 줄 무시
        json.dumps(_rpc("ping", request_id="a")),
        json.dumps(_rpc("render", _manifest(out, sample_png), request_id=7)),
    ]
    reader = io.StringIO("\n".join(lines) + "\n")
    writer = io.StringIO()
    server.serve(reader, writer)

    messages = [json.loads(line) for line in writer.getvalue().splitlines()]
    responses = [m for m in messages if "method" not in m]
    notifications = [m for m in messages if "method" in m]

    assert len(responses) == 3
    assert responses[0]["error"]["code"] == server.PARSE_ERROR
    assert responses[1]["id"] == "a"
    assert responses[2]["id"] == 7
    assert responses[2]["result"]["layer_count"] == 1
    # render 요청은 항목·저장 단계 progress 알림을 응답보다 먼저 발신한다
    assert [n["method"] for n in notifications] == ["progress", "progress"]
    assert all(n["params"]["total"] == 1 for n in notifications)
    assert writer.getvalue().endswith("\n")


def test_render_emits_progress_notifications(tmp_path: Path, sample_png: Path) -> None:
    out = tmp_path / "prog.psd"
    events: list[dict[str, object]] = []
    response = server.handle_message(
        _rpc("render", _manifest(out, sample_png)), notifier=events.append
    )
    assert response is not None
    assert response["id"] == 1
    assert [(e["stage"], e["current"], e["total"]) for e in events] == [
        ("items", 1, 1),
        ("write", 1, 1),
    ]


def test_bare_manifest_emits_no_progress_lines(tmp_path: Path, sample_png: Path) -> None:
    """베어 매니페스트 원샷 — 진행 알림 없이 결과 1줄만(S6-1 CLI 파이프 계약)."""
    out = tmp_path / "bare.psd"
    writer = io.StringIO()
    server.serve(io.StringIO(json.dumps(_manifest(out, sample_png)) + "\n"), writer)
    lines = writer.getvalue().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["result"]["output_path"] == str(out)


def test_bare_manifest_error_returns_response_not_crash(tmp_path: Path) -> None:
    """베어 모드 렌더 실패 — 프로세스 크래시 대신 오류 응답 1줄(_dispatch와 동일 계약)."""
    bad = _manifest(tmp_path / "o.psd", tmp_path / "ghost.png")
    response = server.handle_message(bad)
    assert response is not None
    assert response["id"] is None
    error = response["error"]
    assert isinstance(error, dict)
    assert error["code"] == server.INVALID_PARAMS
    assert "ghost.png" in str(error["message"])


def test_serve_shutdown_stops_loop_after_response() -> None:
    lines = [
        json.dumps(_rpc("ping", request_id=1)),
        json.dumps(_rpc("shutdown", request_id=2)),
        json.dumps(_rpc("ping", request_id=3)),  # 처리 안 됨
    ]
    writer = io.StringIO()
    server.serve(io.StringIO("\n".join(lines) + "\n"), writer)

    responses = [json.loads(line) for line in writer.getvalue().splitlines()]
    assert [r["id"] for r in responses] == [1, 2]  # shutdown 이후 라인 미처리


def test_serve_empty_input_exits_cleanly() -> None:
    writer = io.StringIO()
    server.serve(io.StringIO(""), writer)
    assert writer.getvalue() == ""
