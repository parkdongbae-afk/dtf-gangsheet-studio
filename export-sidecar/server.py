"""stdio JSON-RPC 진입점 (Electron 메인 프로세스 통신) — S6 세션 1.

프로토콜 계약 (STDIO_GUIDE — 반드시 지켜야 하는 운영 규칙):

- **NDJSON**: 요청·응답 모두 개행(``\\n``)으로 구분된 JSON 한 줄. 대용량
  이미지·Base64 전달 금지 — 매니페스트(파일 경로 + cm 좌표)만 흐른다.
- **Unbuffered**: Electron은 ``python -u server.py``로 실행하고, 서버도
  매 응답 후 ``flush()``를 명시 호출한다(이중 방어).
- **UTF-8 고정**: Windows 로캘(cp949)과 무관하게 stdin/stdout을 UTF-8로
  재구성한다 — 파이프로 한글 경로가 깨지는 사고를 원천 차단.
- **stdout은 프로토콜 전용**: 진단 로그는 stderr로만 출력한다.
- EOF(stdin 종료) 시 조용히 종료 — ``cat manifest.json | python server.py``
  파이프라인이 행업 없이 끝나야 한다.

메서드:

- ``ping``: 헬스 체크 → 프로토콜 버전·사이드카 버전
- ``render``: params = JSON Manifest → CMYK PSD/PNG 생성 (renderer.py).
  처리 중 항목별 ``progress`` 알림(id 없음)을 응답 스트림에 끼워 보낸다 —
  클라이언트는 ``method`` 키 유무로 알림·응답을 구분한다(응답은 항상
  ``id`` 키가 있고, 알림에는 없다).
- ``remove_bg``: params = ``{input_path, output_path, model?, defringe_px?}``
  → 배경 제거 + Defringe된 32-bit RGBA PNG를 ``output_path``에 기록
  (removebg.py, v2). STDIO_GUIDE에 따라 **경로만 주고받는다** — 스펙
  (REMOVEBG.MD §4)의 Base64 스트리밍은 프로젝트 stdio 바이너리 금지
  철칙에 위배되어 경로 계약으로 조정. 첫 요청 시에만 모델 세션을 로딩한다.
- ``upscale``: params = ``{input_path, output_path, chain, target_w, target_h,
  fit_mode?, crop?, format?, quality?, dpi?, embed_dpi?, sharpen?, denoise?,
  model?, tile_size?, overlap?, checkpoint_dir?, skip_steps?,
  resume_from_path?}`` → 단계별 AI 업스케일 후 DPI 메타가 포함된 이미지를
  기록한다(upscale.py, UPSCALER.MD v2.0). 체인은 메인 Plan Builder가 산출한
  것을 그대로 받으며, 처리 중 ``step``/``tile``/``encode`` stage의 progress
  알림을 발신한다. ``skip_steps`` > 0이면 ``resume_from_path`` 체크포인트
  step{skip}.png에서 나머지 스텝만 이어 실행한다(§5.3 재개).
- ``auto_trim``: params = ``{input_path, output_path, alpha_threshold?}`` →
  알파 바운딩 박스(임계값 초과 픽셀 최외각)로 크롭한 PNG를 기록
  (autotrim.py). no-op(완전 투명·여백 없음·알파 없는 포맷)은 원본
  경로·치수를 ``trimmed=false``로 돌려준다.
- ``warmup``: params = ``{model?}`` → 기본 모델 세션을 미리 로딩해 첫
  remove_bg 요청의 로딩 대기(수 초~수 분)를 앱 구동 시점으로 흡수한다.
  실패는 INVALID_PARAMS로 응답해 클라이언트가 요청 시 로딩으로 폴백하게 한다.
- ``shutdown``: 정상 응답 후 프로세스 종료

베어 매니페스트 모드: ``method`` 없이 ``output_path``가 있는 객체 한 줄을
그대로 밀어 넣으면 렌더로 해석한다(CLI 파이프 검증용 — STDIO_GUIDE
"cat test_manifest.json | uv run python server.py"). 이 경로는 진행 알림을
내지 않는다(파이프 출력 = 결과 1줄이라는 S6-1 계약 유지).
"""

from __future__ import annotations

import io
import json
import os
import sys
from collections.abc import Callable, Mapping
from typing import IO, Final

import autotrim
import removebg
import renderer
import upscale
from autotrim import AutoTrimError
from removebg import RemoveBgError
from renderer import ManifestError
from upscale import UpscaleError

__version__ = "0.1.0"  # pyproject [project].version과 동기 유지

PROTOCOL_VERSION: Final[int] = 1
SIDECAR_NAME: Final[str] = "dtf-export-sidecar"

# progress 알림 발신기 — serve가 writer로 조립해 handle_message로 전달한다
Notifier = Callable[[dict[str, object]], None]

PARSE_ERROR: Final[int] = -32700
INVALID_REQUEST: Final[int] = -32600
METHOD_NOT_FOUND: Final[int] = -32601
INVALID_PARAMS: Final[int] = -32602
INTERNAL_ERROR: Final[int] = -32603


def handle_message(
    message: object, notifier: Notifier | None = None
) -> dict[str, object] | None:
    """요청 객체 1개를 처리해 응답 dict 반환 — 응답 없음(알림)이면 None.

    순수 함수가 아니라 렌더 부작용(PSD·PNG 생성)을 포함하며, ``notifier``가
    있으면 render 진행을 progress 알림으로 발신한다. 테스트는 임시
    매니페스트로 직접 호출한다.
    """
    if not isinstance(message, dict):
        return _error(None, INVALID_REQUEST, "request must be a JSON object")
    if "method" not in message:
        # 베어 매니페스트 원샷 — 진행 알림 없음(파이프 출력 1줄 계약, STDIO_GUIDE).
        # 렌더 실패는 프로세스 크래시가 아니라 오류 응답 1줄로(_dispatch와 동일 계약)
        if "output_path" in message:
            try:
                result = _render_manifest(message)
            except ManifestError as exc:
                return _error(None, INVALID_PARAMS, str(exc))
            except Exception as exc:  # noqa: BLE001 — 프로세스 생존이 우선
                return _error(None, INTERNAL_ERROR, f"{type(exc).__name__}: {exc}")
            return _respond(None, result)
        return _error(None, INVALID_REQUEST, "request must have 'method' or be a manifest")
    return _dispatch(message, notifier)


def serve(reader: IO[str], writer: IO[str]) -> None:
    """NDJSON 루프 — EOF까지 한 줄씩 처리. shutdown 요청은 응답 후 루프 탈출."""

    def notifier(params: dict[str, object]) -> None:
        _write(writer, {"jsonrpc": "2.0", "method": "progress", "params": params})

    for line in reader:
        stripped = line.strip()
        if not stripped:
            continue
        try:
            message: object = json.loads(stripped)
        except json.JSONDecodeError as exc:
            _write(writer, _error(None, PARSE_ERROR, f"malformed JSON line: {exc.msg}"))
            continue
        response = handle_message(message, notifier)
        if response is not None:
            _write(writer, response)
        if isinstance(message, dict) and message.get("method") == "shutdown":
            _log("shutdown requested")
            break


def _dispatch(
    message: dict[str, object], notifier: Notifier | None = None
) -> dict[str, object] | None:
    method = message.get("method")
    if not isinstance(method, str) or not method:
        return _error(message.get("id"), INVALID_REQUEST, "'method' must be a non-empty string")
    request_id: object | None = None
    is_notification = "id" not in message
    if not is_notification:
        request_id = message["id"]

    try:
        result: dict[str, object]
        if method == "ping":
            result = {
                "protocol": PROTOCOL_VERSION,
                "name": SIDECAR_NAME,
                "version": __version__,
            }
        elif method == "render":
            result = _render_manifest(message.get("params"), notifier)
        elif method == "remove_bg":
            result = _remove_bg(message.get("params"))
        elif method == "auto_trim":
            result = _auto_trim(message.get("params"))
        elif method == "upscale":
            result = _upscale(message.get("params"), notifier)
        elif method == "warmup":
            result = _warmup(message.get("params"))
        elif method == "shutdown":
            result = {"status": "bye"}
        else:
            if is_notification:
                _log(f"unknown notification method ignored: {method!r}")
                return None
            return _error(request_id, METHOD_NOT_FOUND, f"unknown method: {method!r}")
    except ManifestError as exc:  # 입력 문제 — 매니페스트 스키마·파일·치수
        return _notify_or_error(request_id, is_notification, INVALID_PARAMS, str(exc))
    except RemoveBgError as exc:  # 입력 문제 — 경로·모델명·디코드 실패 (remove_bg)
        return _notify_or_error(request_id, is_notification, INVALID_PARAMS, str(exc))
    except AutoTrimError as exc:  # 입력 문제 — 경로·디코드·임계값 실패 (auto_trim)
        return _notify_or_error(request_id, is_notification, INVALID_PARAMS, str(exc))
    except UpscaleError as exc:  # 입력 문제 — 경로·체인·치수·모델 다운로드 실패 (upscale)
        return _notify_or_error(request_id, is_notification, INVALID_PARAMS, str(exc))
    except Exception as exc:  # noqa: BLE001 — 프로세스 생존이 우선, 오류는 응답으로 전달
        detail = f"{type(exc).__name__}: {exc}"
        return _notify_or_error(request_id, is_notification, INTERNAL_ERROR, detail)
    if is_notification:
        return None
    return _respond(request_id, result)


def _render_manifest(
    params: object, notifier: Notifier | None = None
) -> dict[str, object]:
    """render 메서드 본문 — 매니페스트 파싱·렌더, 결과는 메타데이터만 반환.

    notifier가 있으면 항목별 진행을 ``{"stage","current","total"}`` progress
    알림으로 발신한다(renderer.ProgressCallback → NDJSON 변환).
    """
    if not isinstance(params, Mapping):
        raise ManifestError("'params' must be an object (export manifest)")
    manifest = renderer.parse_manifest(params)

    def on_progress(stage: str, current: int, total: int) -> None:
        if notifier is not None:
            notifier({"stage": stage, "current": current, "total": total})

    _log(f"render start: {len(manifest.items)} item(s) -> {manifest.output_path}")
    result = renderer.render_manifest(manifest, on_progress)
    _log(f"render done: {result.layer_count} layer(s), {result.duration_ms} ms")
    return {
        "output_path": str(result.output_path),
        "width_px": result.width_px,
        "height_px": result.height_px,
        "layer_count": result.layer_count,
        "duration_ms": result.duration_ms,
    }


def _remove_bg(params: object) -> dict[str, object]:
    """remove_bg 메서드 본문 — 경로 기반 배경 제거, 응답은 메타데이터만.

    세션 로딩(모델 수백 MB)·추론은 수 초~수분 소요될 수 있어 요청은
    동기로 처리한다(진행 알림 없음 — 렌더와 달리 단일 항목이다).
    """
    if not isinstance(params, Mapping):
        raise RemoveBgError("'params' must be an object (remove_bg request)")
    input_path = params.get("input_path")
    output_path = params.get("output_path")
    if not isinstance(input_path, str) or not input_path:
        raise RemoveBgError("'input_path' must be a non-empty string")
    if not isinstance(output_path, str) or not output_path:
        raise RemoveBgError("'output_path' must be a non-empty string")
    model = params.get("model", removebg.DEFAULT_MODEL)
    if not isinstance(model, str) or not model:
        raise RemoveBgError("'model' must be a non-empty string")
    defringe_px = params.get("defringe_px", removebg.DEFAULT_DEFRINGE_PX)
    if isinstance(defringe_px, bool) or not isinstance(defringe_px, int) or defringe_px < 0:
        raise RemoveBgError("'defringe_px' must be an integer >= 0")

    _log(f"remove_bg start: {input_path} -> {output_path} (model={model})")
    result = removebg.process_file(input_path, output_path, model, defringe_px)
    _log(f"remove_bg done: {result.width_px}x{result.height_px}")
    return {
        "output_path": str(output_path),
        "width_px": result.width_px,
        "height_px": result.height_px,
    }


def _auto_trim(params: object) -> dict[str, object]:
    """auto_trim 메서드 본문 — 경로 기반 투명 여백 트림, 응답은 메타데이터만.

    no-op(완전 투명·여백 없음·알파 없는 포맷)도 정상 응답이다 — 원본 경로·
    치수에 ``trimmed=false``만 붙여 돌려준다(클라이언트 폴백 불필요).
    """
    if not isinstance(params, Mapping):
        raise AutoTrimError("'params' must be an object (auto_trim request)")
    input_path = params.get("input_path")
    output_path = params.get("output_path")
    if not isinstance(input_path, str) or not input_path:
        raise AutoTrimError("'input_path' must be a non-empty string")
    if not isinstance(output_path, str) or not output_path:
        raise AutoTrimError("'output_path' must be a non-empty string")
    alpha_threshold = params.get("alpha_threshold", autotrim.DEFAULT_ALPHA_THRESHOLD)
    if (
        isinstance(alpha_threshold, bool)
        or not isinstance(alpha_threshold, int)
        or not 0 <= alpha_threshold <= autotrim.MAX_ALPHA_THRESHOLD
    ):
        raise AutoTrimError(
            f"'alpha_threshold' must be an integer in 0..{autotrim.MAX_ALPHA_THRESHOLD}"
        )

    _log(f"auto_trim start: {input_path} -> {output_path} (threshold={alpha_threshold})")
    result = autotrim.auto_trim_file(input_path, output_path, alpha_threshold)
    _log(
        f"auto_trim done: trimmed={result.trimmed}"
        f" {result.width_px}x{result.height_px} -> {result.output_path}"
    )
    return {
        "output_path": result.output_path,
        "width_px": result.width_px,
        "height_px": result.height_px,
        "trimmed": result.trimmed,
    }


def _upscale(params: object, notifier: Notifier | None = None) -> dict[str, object]:
    """upscale 메서드 본문 — 경로 기반 단계별 업스케일, 응답은 메타데이터만.

    체인·타겋 치수는 이미 메인 Plan Builder(src/core/upscaler/plan.ts)가
    검증·산출한 값이다. 여기서는 JSON 역직렬화 경계의 타입만 재검증한다.
    스텝·타일·인코딩 진행은 progress 알림으로 발신한다(upscale.py → NDJSON).
    """
    if not isinstance(params, Mapping):
        raise UpscaleError("'params' must be an object (upscale request)")
    input_path = params.get("input_path")
    output_path = params.get("output_path")
    if not isinstance(input_path, str) or not input_path:
        raise UpscaleError("'input_path' must be a non-empty string")
    if not isinstance(output_path, str) or not output_path:
        raise UpscaleError("'output_path' must be a non-empty string")

    chain_raw = params.get("chain")
    if not isinstance(chain_raw, list) or not chain_raw:
        raise UpscaleError("'chain' must be a non-empty array of numbers")
    chain = [float(s) for s in chain_raw]

    target_w = params.get("target_w")
    target_h = params.get("target_h")
    if isinstance(target_w, bool) or not isinstance(target_w, int):
        raise UpscaleError("'target_w' must be an integer")
    if isinstance(target_h, bool) or not isinstance(target_h, int):
        raise UpscaleError("'target_h' must be an integer")

    fit_mode = params.get("fit_mode", "KEEP_RATIO")
    if fit_mode not in ("KEEP_RATIO", "COVER", "CONTAIN", "STRETCH"):
        raise UpscaleError(f"'fit_mode' must be one of KEEP_RATIO/COVER/CONTAIN/STRETCH: {fit_mode!r}")

    crop_raw = params.get("crop")
    crop: tuple[int, int, int, int] | None = None
    if crop_raw is not None:
        if not isinstance(crop_raw, Mapping):
            raise UpscaleError("'crop' must be an object {x,y,w,h} or null")
        parts = [crop_raw.get(key) for key in ("x", "y", "w", "h")]
        if any(isinstance(v, bool) or not isinstance(v, int) for v in parts):
            raise UpscaleError("'crop' values must be integers")
        crop = (parts[0], parts[1], parts[2], parts[3])  # type: ignore[arg-type]

    fmt = params.get("format", "png")
    if fmt not in ("png", "jpeg", "webp"):
        raise UpscaleError(f"'format' must be png/jpeg/webp: {fmt!r}")
    quality = params.get("quality", 0.95)
    if isinstance(quality, bool) or not isinstance(quality, (int, float)):
        raise UpscaleError("'quality' must be a number in (0, 1]")
    dpi = params.get("dpi", 300)
    if isinstance(dpi, bool) or not isinstance(dpi, int):
        raise UpscaleError("'dpi' must be an integer")
    embed_dpi = params.get("embed_dpi", True)
    if not isinstance(embed_dpi, bool):
        raise UpscaleError("'embed_dpi' must be a boolean")
    sharpen = params.get("sharpen", upscale.DEFAULT_SHARPEN)
    if isinstance(sharpen, bool) or not isinstance(sharpen, (int, float)):
        raise UpscaleError("'sharpen' must be a number in 0..1")
    denoise = params.get("denoise", 0)
    if isinstance(denoise, bool) or not isinstance(denoise, int):
        raise UpscaleError("'denoise' must be 0, 1 or 2")
    tile_size = params.get("tile_size")
    if tile_size is not None and (isinstance(tile_size, bool) or not isinstance(tile_size, int)):
        raise UpscaleError("'tile_size' must be an integer or null")
    overlap = params.get("overlap")
    if overlap is not None and (isinstance(overlap, bool) or not isinstance(overlap, int)):
        raise UpscaleError("'overlap' must be an integer or null")
    checkpoint_dir = params.get("checkpoint_dir")
    if checkpoint_dir is not None and not isinstance(checkpoint_dir, str):
        raise UpscaleError("'checkpoint_dir' must be a string or null")
    model = params.get("model", upscale.DEFAULT_MODEL)
    if not isinstance(model, str) or model not in upscale.MODEL_URLS:
        raise UpscaleError(
            f"'model' must be one of {sorted(upscale.MODEL_URLS)}: {model!r}"
        )
    resume_from_path = params.get("resume_from_path")
    if resume_from_path is not None and not isinstance(resume_from_path, str):
        raise UpscaleError("'resume_from_path' must be a string or null")
    skip_steps = params.get("skip_steps", 0)
    if isinstance(skip_steps, bool) or not isinstance(skip_steps, int):
        raise UpscaleError("'skip_steps' must be an integer >= 0")

    def on_progress(
        stage: str, step: int, total_steps: int, current: int, total: int
    ) -> None:
        if notifier is not None:
            notifier(
                {
                    "stage": stage,
                    "step": step,
                    "total_steps": total_steps,
                    "current": current,
                    "total": total,
                }
            )

    _log(
        f"upscale start: {input_path} -> {output_path}"
        f" (chain={chain_raw}, {target_w}x{target_h}, model={model}, skip={skip_steps})"
    )
    result = upscale.process_file(
        input_path,
        output_path,
        chain,
        target_w,
        target_h,
        fit_mode=fit_mode,
        crop=crop,
        fmt=fmt,
        quality=float(quality),
        dpi=dpi,
        embed_dpi=embed_dpi,
        sharpen=float(sharpen),
        denoise=denoise,
        model=model,
        tile=tile_size,
        overlap=overlap,
        checkpoint_dir=checkpoint_dir,
        on_progress=on_progress,
        resume_from=resume_from_path,
        skip_steps=skip_steps,
    )
    _log(f"upscale done: {result.width_px}x{result.height_px}, {result.duration_ms} ms")
    return {
        "output_path": result.output_path,
        "width_px": result.width_px,
        "height_px": result.height_px,
        "duration_ms": result.duration_ms,
        "steps": [
            {
                "scale": record.scale,
                "out_w": record.out_w,
                "out_h": record.out_h,
                "ms": record.ms,
            }
            for record in result.steps
        ],
    }


def _warmup(params: object) -> dict[str, object]:
    """warmup 메서드 본문 — 모델 세션을 미리 로딩만 수행(파일 부작용 없음).

    모델명 검증·로딩 실패는 RemoveBgError(INVALID_PARAMS)로 매핑해 클라이언트가
    예열 실패를 무시하고 요청 시 로딩 경로로 폴백할 수 있게 한다.
    """
    model = removebg.DEFAULT_MODEL
    if params is not None:
        if not isinstance(params, Mapping):
            raise RemoveBgError("'params' must be an object (warmup request)")
        model = params.get("model", removebg.DEFAULT_MODEL)
        if not isinstance(model, str) or not model:
            raise RemoveBgError("'model' must be a non-empty string")

    _log(f"warmup start: model={model}")
    try:
        removebg.get_session(model)
    except Exception as exc:  # 모델명 오류·가중치 로딩 실패 — 안내 가능한 입력 문제
        raise RemoveBgError(f"model load failed ({model}): {type(exc).__name__}: {exc}") from exc
    _log("warmup done")
    return {"status": "ready", "model": model}


def _respond(request_id: object, result: dict[str, object]) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: object, code: int, message: str) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _notify_or_error(
    request_id: object, is_notification: bool, code: int, message: str
) -> dict[str, object] | None:
    """알림(응답 없음)이면 stderr 로그만, 요청이면 오류 응답."""
    if is_notification:
        _log(f"notification failed ({code}): {message}")
        return None
    return _error(request_id, code, message)


def _write(writer: IO[str], payload: dict[str, object]) -> None:
    writer.write(json.dumps(payload, ensure_ascii=False) + "\n")
    writer.flush()  # 버퍼링 무한 대기 방지 — -u 옵션과 이중 방어 (STDIO_GUIDE)


def _log(message: str) -> None:
    print(f"[sidecar] {message}", file=sys.stderr)


def main() -> None:
    """진입점 — stdio를 UTF-8로 재구성(Windows 로캘 무관) 후 NDJSON 루프.

    stderr도 UTF-8로 못박는다: 표준 파이썬은 stderr가 backslashreplace라
    로그로 크래시하지 않지만, PyInstaller 번들 환경의 stderr 정책은 보장되지
    않으므로 진단 로그("[sidecar] 한글 경로…")가 요청을 죽이는 일을 원천 차단한다.
    """
    if isinstance(sys.stdin, io.TextIOWrapper):
        sys.stdin.reconfigure(encoding="utf-8")
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    if isinstance(sys.stderr, io.TextIOWrapper):
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    try:
        serve(sys.stdin, sys.stdout)
    except BrokenPipeError:
        # 부모(Electron) 종료로 파이프가 끊김 — 종료 시 flush 추적백 방지(Python 공식 레시피)
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, sys.stdout.fileno())


if __name__ == "__main__":
    main()
