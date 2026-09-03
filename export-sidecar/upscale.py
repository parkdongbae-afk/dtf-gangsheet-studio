"""AI 업스케일 파이프라인 — UPSCALER.MD v2.0 스펙 기반 (체인 실행·타일링·DPI 임베드).

아키텍처 (스펙의 onnxruntime-web/Web Worker를 본 프로젝트 사이드카 계약으로 이식):

- **엔진**: RealESRGAN x4 ONNX를 onnxruntime CPU로 실행한다(rembg 의존성에 이미
  포함 — 별도 런타임 설치 불필요). 모델 가중치는 ``U2NET_HOME``(없으면 ~/.u2net)
  에서 ``<model>.onnx``로 찾고 없으면 1회 다운로드한다(removebg와 동일 계약).
- **단계별 체인**: 메인 프로세스 Plan Builder(src/core/upscaler/plan.ts)가
  산출한 체인(예: [2, 2, 2.5])을 통째로 받아 사이드카 내에서 순회한다.
  스텝별·타일별 진행을 progress 알림으로 발신한다(server.py notifier).
- **비-x4 배율**: 모델은 x4 고정 — 스텝 배율 s에 대해 ``ceil(s/4)``회(≤2) x4
  추론 후 Lanczos/AREA로 s배 치수에 정밀 리사이즈한다(체인 스텝 ≤ K×1.25 가정).
- **알파 보존**: RGB만 모델에 통과시키고 알파는 스텝마다 동일 치수로 리사이즈해
  재합성한다(투명 PNG의 누끼 경계 유지 — DTF 알파=백색 잉크 철칙).
- **타일링**: 한 스텝의 모델 출력이 4096px를 넘으면 512px 타일 × 32px 오버랩,
  경계는 거리 기반 페더 가중 블렌딩으로 이음새를 지운다(§5.4).
- **DPI 임베드**: PNG pHYs / JPEG JFIF 밀도로 기록해 인쇄 프로그램이 실제 cm
  크기를 인식하게 한다(§5.5). WebP는 밀도 규격이 없어 생략한다.
- **입력 정규화**: EXIF 회전 적용·원본 EXIF 미복사(위치정보 제거, §6.3),
  16bit/CMYK는 8bit RGBA로 변환한다.
- **메모리**: 스텝 종료마다 중간 버퍼 ``del`` + ``gc.collect()`` (§6.4).
"""

from __future__ import annotations

import gc
import io
import math
import os
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

if TYPE_CHECKING:
    from onnxruntime import InferenceSession

# 기본 모델 — realesrgan-x4plus 변환 ONNX(일반 사진용, 64MB).
# 입출력 계약: input [1,3,h,w] float 0..1 → output [1,3,4h,4w] (NCHW 동적 치수).
# anime 엔진은 RealESR-AnimeVideo-v3 x4(약 2.4MB) — 일러스트·애니메이션 계열.
DEFAULT_MODEL: str = "RealESRGAN_x4"
MODEL_URLS: dict[str, str] = {
    "RealESRGAN_x4": "https://huggingface.co/anakhiu/realesrgan-onnx/resolve/main/realesrgan_x4plus.onnx",
    "RealESR-AnimeVideo-x4": "https://huggingface.co/tidus2102/Real-ESRGAN/resolve/main/RealESR-AnimeVideo-v3_x4.onnx",
}
ENGINE_ALIASES: dict[str, str] = {
    "general": "RealESRGAN_x4",
    "anime": "RealESR-AnimeVideo-x4",
}
# 모델 고정 배율 — 비-x4 스텝 배율은 추론 후 정밀 리사이즈로 맞춘다
MODEL_SCALE: int = 4
# 스텝당 최대 모델 통과 수 — 체인 스텝은 K×1.25 이하(≤6.25)므로 2회면 충분
MAX_MODEL_PASSES: int = 2

# 타일링 기본값 — §5.4 (타일 256/512, 오버랩 16/32)
DEFAULT_TILE_SIZE: int = 512
DEFAULT_TILE_OVERLAP: int = 32
# 한 스텝의 모델 출력이 이 변 길이를 넘으면 타일링 강제 (§5.4)
TILE_FORCE_THRESHOLD_PX: int = 4096
# 스텝 간 샤픈 기본 강도 (0~1)
DEFAULT_SHARPEN: float = 0.3
# 스텝당 상한 — 초과 시 ERR_TIMEOUT 대응 오류 (§6.2)
STEP_TIMEOUT_S: float = 300.0
# PNG 압축 레벨 — 속도 우선(무손실은 PNG 자체가 보장)
PNG_COMPRESS_LEVEL: int = 1

OutputFormat = Literal["png", "jpeg", "webp"]
FitMode = Literal["KEEP_RATIO", "COVER", "CONTAIN", "STRETCH"]

# stage('step'|'tile'|'encode'), step(1-based), total_steps, current, total
ProgressCallback = Callable[[str, int, int, int, int], None]


class UpscaleError(Exception):
    """업스케일 입력 문제 — 서버에서 INVALID_PARAMS(-32602)로 매핑한다."""


@dataclass(frozen=True)
class StepRecord:
    """스텝 실행 기록 — 응답 메타데이터(치수·소요 ms)만 담는다."""

    scale: float
    out_w: int
    out_h: int
    ms: int


@dataclass(frozen=True)
class UpscaleResult:
    output_path: str
    width_px: int
    height_px: int
    duration_ms: int
    steps: tuple[StepRecord, ...]


# 모델명 → 로딩된 세션. 프로세스 생애 동안 유지(세션 캐싱).
_sessions: dict[str, InferenceSession] = {}


def get_session(model: str) -> InferenceSession:
    """onnxruntime 세션 조회 — 미로딩 모델만 생성 후 캐싱(가중치 다운로드 포함).

    onnxruntime 임포트도 이 시점에 처음 수행한다(export 전용 스폰과 결합 0).
    """
    session = _sessions.get(model)
    if session is None:
        import onnxruntime as ort

        weight = _resolve_weight(model)
        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, (os.cpu_count() or 4) - 1)
        session = ort.InferenceSession(
            str(weight), options, providers=["CPUExecutionProvider"]
        )
        _sessions[model] = session
    return session


def _resolve_weight(model: str) -> Path:
    """모델 가중치 경로 — U2NET_HOME(removebg와 공유 홈)에서 <model>.onnx 탐색."""
    url = MODEL_URLS.get(model)
    if url is None:
        raise UpscaleError(f"unknown upscale model: {model!r}")
    home = Path(os.environ.get("U2NET_HOME", str(Path.home() / ".u2net")))
    home.mkdir(parents=True, exist_ok=True)
    weight = home / f"{model}.onnx"
    if not weight.is_file():
        _download_weight(url, weight)
    return weight


def _download_weight(url: str, dest: Path) -> None:
    """가중치 1회 다운로드 — 임시 파일 수신 후 원자적 rename(중단 시 잔류 방지)."""
    tmp = dest.with_suffix(".part")
    try:
        with urllib.request.urlopen(url, timeout=60) as resp, open(tmp, "wb") as out:
            while True:
                chunk = resp.read(4 * 1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        tmp.replace(dest)
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        raise UpscaleError(f"model download failed ({url}): {exc}") from exc


def load_rgba(input_path: Path) -> np.ndarray:
    """파일 → EXIF 회전 적용·8bit RGBA 배열. 원본 EXIF는 결과에 복사하지 않는다(§6.3)."""
    try:
        img = Image.open(input_path)
        img = ImageOps.exif_transpose(img)
        rgba = np.asarray(img.convert("RGBA"), dtype=np.uint8).copy()
        img.close()
        return rgba
    except (UnidentifiedImageError, OSError) as exc:
        raise UpscaleError(f"cannot decode input image: {exc}") from exc


def plan_tiles(width: int, height: int, tile: int, overlap: int) -> list[tuple[int, int, int, int]]:
    """타일 그리드 (x, y, w, h) — 오버랩 보폭, 마지막은 가장자리에 흡수."""
    if tile <= overlap * 2:
        raise UpscaleError(f"tile size must be > 2x overlap (tile={tile}, overlap={overlap})")
    if width <= 0 or height <= 0:
        raise UpscaleError(f"image size must be positive: {width}x{height}")

    def axis(length: int) -> list[tuple[int, int]]:
        spans: list[tuple[int, int]] = []
        pos = 0
        while True:
            size = min(tile, length - pos)
            spans.append((pos, size))
            if pos + size >= length:
                break
            pos += size - overlap
        return spans

    return [(tx, ty, tw, th) for ty, th in axis(height) for tx, tw in axis(width)]


def tile_weights(w: int, h: int, overlap: int, interior_x: bool, interior_y: bool) -> np.ndarray:
    """타일 페더 가중치 — 이웃 타일과 겹치는 내부 변만 overlap 폭 선형 램프.

    바깥변(캔버스 가장자리)은 1을 유지해 끝 픽셀이 감쇠하지 않는다. 모서리는
    두 램프의 곱으로 자연스러운 2차원 페이드가 된다. 합이 0인 픽셀은 조립
    단계(upscale_rgb)에서 하한 클램프로 보정한다.
    """
    weights = np.ones((h, w), dtype=np.float32)
    if overlap <= 0:
        return weights
    ramp = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
    if interior_x:
        weights[:, :overlap] *= ramp[None, :]
        weights[:, -overlap:] *= ramp[::-1][None, :]
    if interior_y:
        weights[:overlap, :] *= ramp[:, None]
        weights[-overlap:, :] *= ramp[::-1][:, None]
    return weights


def _run_model_tile(session: InferenceSession, rgb: np.ndarray) -> np.ndarray:
    """단일 타일 RGB(uint8) → x4 RGB(uint8). 모델 입출력은 NCHW float 0..1."""
    chw = np.ascontiguousarray(rgb.transpose(2, 0, 1))[None].astype(np.float32) / 255.0
    outputs = session.run(None, {session.get_inputs()[0].name: chw})
    out = np.asarray(outputs[0])
    if out.ndim == 4:
        out = out[0]
    hwc = np.clip(out.transpose(1, 2, 0), 0.0, 1.0)
    return (hwc * 255.0).round().astype(np.uint8)


def upscale_rgb(
    rgb: np.ndarray,
    session: InferenceSession,
    tile: int,
    overlap: int,
    force_tiling: bool,
    on_tile: Callable[[int, int], None] | None = None,
) -> np.ndarray:
    """RGB 배열 1장을 x4로 확대 — 임계 초과·강제 시 타일 분할 + 페더 블렌딩."""
    src_h, src_w = rgb.shape[0], rgb.shape[1]
    out_w, out_h = src_w * MODEL_SCALE, src_h * MODEL_SCALE
    if not force_tiling and max(out_w, out_h) <= TILE_FORCE_THRESHOLD_PX:
        if on_tile is not None:
            on_tile(1, 1)
        return _run_model_tile(session, rgb)

    tiles = plan_tiles(src_w, src_h, tile, overlap)
    canvas = np.zeros((out_h, out_w, 3), dtype=np.float32)
    weight_sum = np.zeros((out_h, out_w), dtype=np.float32)
    for index, (tx, ty, tw, th) in enumerate(tiles):
        upscaled = _run_model_tile(session, rgb[ty : ty + th, tx : tx + tw])
        uw, uh = tw * MODEL_SCALE, th * MODEL_SCALE
        weights = tile_weights(
            uw,
            uh,
            overlap * MODEL_SCALE,
            interior_x=tx > 0 and tx + tw < src_w,
            interior_y=ty > 0 and ty + th < src_h,
        )
        oy, ox = ty * MODEL_SCALE, tx * MODEL_SCALE
        canvas[oy : oy + uh, ox : ox + uw] += upscaled.astype(np.float32) * weights[..., None]
        weight_sum[oy : oy + uh, ox : ox + uw] += weights
        if on_tile is not None:
            on_tile(index + 1, len(tiles))
    np.maximum(weight_sum, 1e-6, out=weight_sum)
    return (canvas / weight_sum[..., None]).round().clip(0, 255).astype(np.uint8)


def resize_exact(rgba: np.ndarray, width: int, height: int) -> np.ndarray:
    """RGBA를 정확한 치수로 — 축소면 AREA, 확대면 LANCZOS4 (스텝·최종 보정 공용)."""
    if width < 1 or height < 1:
        raise UpscaleError(f"resize target must be positive: {width}x{height}")
    if rgba.shape[1] == width and rgba.shape[0] == height:
        return rgba
    interp = cv2.INTER_AREA if (width < rgba.shape[1] and height < rgba.shape[0]) else cv2.INTER_LANCZOS4
    return cv2.resize(rgba, (width, height), interpolation=interp)


def apply_unsharp(rgb: np.ndarray, amount: float) -> np.ndarray:
    """언샵 마스크 — 스텝 간 샤픈(§5.2). amount 0~1."""
    if amount <= 0:
        return rgb
    blur = cv2.GaussianBlur(rgb, (0, 0), 1.5)
    return cv2.addWeighted(rgb, 1.0 + amount, blur, -amount, 0)


def apply_denoise(rgb: np.ndarray, level: int) -> np.ndarray:
    """사전 노이즈 제거 — 1=양방향 필터(가벼움), 2=NL-means(느림·강함)."""
    if level <= 0:
        return rgb
    if level == 1:
        return cv2.bilateralFilter(rgb, 5, 25, 25)
    return cv2.fastNlMeansDenoisingColored(rgb, None, 3, 3, 7, 21)


def encode_image(
    rgba: np.ndarray, fmt: OutputFormat, quality: float, dpi: int, embed_dpi: bool
) -> bytes:
    """RGBA → 포맷 인코딩. PNG pHYs/JPEG JFIF에 DPI 밀도를 기록한다(§5.5).

    JPEG은 알파를 흰 배경으로 합성한다(투명 영역의 인쇄 대응).
    """
    with Image.fromarray(rgba, "RGBA") as img:
        buffer = io.BytesIO()
        if fmt == "png":
            kwargs: dict[str, object] = {"compress_level": PNG_COMPRESS_LEVEL}
            if embed_dpi:
                kwargs["dpi"] = (dpi, dpi)
            img.save(buffer, format="PNG", **kwargs)
        elif fmt == "jpeg":
            with Image.new("RGBA", img.size, (255, 255, 255, 255)) as background:
                background.alpha_composite(img)
                background.convert("RGB").save(
                    buffer,
                    format="JPEG",
                    quality=round(quality * 100),
                    **({"dpi": (dpi, dpi)} if embed_dpi else {}),
                )
        else:
            img.save(buffer, format="WEBP", quality=round(quality * 100))
        return buffer.getvalue()


def _resolve_tiling(width: int, height: int, tile: int | None, overlap: int | None) -> tuple[int, int, bool]:
    """타일 파라미터 확정 — 명시 값이면 강제, 없으면 4096 임계 자동(§5.4)."""
    ovl = DEFAULT_TILE_OVERLAP if overlap is None else overlap
    if tile is not None:
        return tile, ovl, True
    forced = max(width, height) * MODEL_SCALE > TILE_FORCE_THRESHOLD_PX
    return DEFAULT_TILE_SIZE, ovl, forced


def _validate_request(
    chain: list[float],
    target_w: int,
    target_h: int,
    fmt: str,
    quality: float,
    dpi: int,
    sharpen: float,
    denoise: int,
) -> None:
    if not chain or any(not (s > 0) for s in chain):
        raise UpscaleError("'chain' must be a non-empty list of positive numbers")
    if not (1 <= target_w <= 30000 and 1 <= target_h <= 30000):
        raise UpscaleError(f"target size out of range: {target_w}x{target_h}")
    if fmt not in ("png", "jpeg", "webp"):
        raise UpscaleError(f"unsupported format: {fmt!r}")
    if not (0 < quality <= 1):
        raise UpscaleError(f"'quality' must be in (0, 1]: {quality}")
    if not (1 <= dpi <= 1200):
        raise UpscaleError(f"'dpi' must be in 1..1200: {dpi}")
    if not (0 <= sharpen <= 1):
        raise UpscaleError(f"'sharpen' must be in 0..1: {sharpen}")
    if denoise not in (0, 1, 2):
        raise UpscaleError(f"'denoise' must be 0, 1 or 2: {denoise}")


def process_file(
    input_path: str | Path,
    output_path: str | Path,
    chain: list[float],
    target_w: int,
    target_h: int,
    fit_mode: FitMode = "KEEP_RATIO",
    crop: tuple[int, int, int, int] | None = None,
    fmt: OutputFormat = "png",
    quality: float = 0.95,
    dpi: int = 300,
    embed_dpi: bool = True,
    sharpen: float = DEFAULT_SHARPEN,
    denoise: int = 0,
    model: str = DEFAULT_MODEL,
    tile: int | None = None,
    overlap: int | None = None,
    checkpoint_dir: str | Path | None = None,
    on_progress: ProgressCallback | None = None,
    resume_from: str | Path | None = None,
    skip_steps: int = 0,
) -> UpscaleResult:
    """파일→파일 업스케일 — server.py ``upscale`` 메서드 본문.

    체인은 Plan Builder 산출물을 그대로 받는다(총 배율 ≤ 1.5 리샘플 체인은
    모델을 로딩하지 않는다). 타임아웃은 타일·스텝 경계에서 검사한다(§5.3).
    스텝 산출물은 checkpoint_dir가 있으면 step{n}.png로 남긴다(§5.6).

    재개(§5.3·§5.6): ``skip_steps`` > 0이면 ``resume_from``(step{skip}.png)을
    시작 이미지로 삼아 나머지 스텝만 실행한다 — crop·denoise는 이미 적용된
    상태로 간주해 건너뛰고, 진행 알림·체크포인트 번호는 전체 체인 기준으로
    이어 쓴다. 응답 steps에는 실행된 스텝만 담긴다(메인이 번호를 보정).
    """
    src = Path(input_path)
    if not src.is_file():
        raise UpscaleError(f"input file not found: {src}")
    _validate_request(chain, target_w, target_h, fmt, quality, dpi, sharpen, denoise)
    if not 0 <= skip_steps < len(chain):
        raise UpscaleError(f"skip_steps must be in 0..{len(chain) - 1}: {skip_steps}")
    if model not in MODEL_URLS:
        raise UpscaleError(f"unknown model {model!r} — available: {sorted(MODEL_URLS)}")

    started = time.perf_counter()
    if skip_steps > 0:
        resume_path = Path(resume_from) if resume_from is not None else None
        if resume_path is None or not resume_path.is_file():
            raise UpscaleError(f"resume checkpoint not found: {resume_from}")
        rgba = load_rgba(resume_path)
    else:
        rgba = load_rgba(src)
        if crop is not None:
            cx, cy, cw, ch = crop
            src_w, src_h = rgba.shape[1], rgba.shape[0]
            if not (0 <= cx and 0 <= cy and cx + cw <= src_w and cy + ch <= src_h and cw > 0 and ch > 0):
                raise UpscaleError(f"crop rect out of bounds: {crop} for {src_w}x{src_h}")
            rgba = rgba[cy : cy + ch, cx : cx + cw].copy()

        if denoise > 0:
            denoised = apply_denoise(rgba[:, :, :3], denoise)
            rgba = np.dstack([denoised, rgba[:, :, 3]])
            del denoised

    remaining = chain[skip_steps:]
    total_scale = float(np.prod(remaining))
    session = get_session(model) if total_scale > 1.5 else None

    records: list[StepRecord] = []
    for offset, scale in enumerate(remaining):
        step_no = skip_steps + offset + 1
        if on_progress is not None:
            on_progress("step", step_no, len(chain), 0, 1)
        step_t0 = time.perf_counter()

        cur_w, cur_h = rgba.shape[1], rgba.shape[0]
        next_w = max(1, round(cur_w * scale))
        next_h = max(1, round(cur_h * scale))

        if session is not None and scale > 1.5:
            rgb = rgba[:, :, :3]
            passes = min(MAX_MODEL_PASSES, max(1, math.ceil(scale / MODEL_SCALE)))
            for _ in range(passes):
                tile_size, ovl, forced = _resolve_tiling(rgb.shape[1], rgb.shape[0], tile, overlap)

                def on_tile(done: int, total: int, s: int = step_no, n: int = len(chain)) -> None:
                    if on_progress is not None:
                        on_progress("tile", s, n, done, total)

                rgb = upscale_rgb(rgb, session, tile_size, ovl, forced, on_tile)
                if time.perf_counter() - step_t0 > STEP_TIMEOUT_S:
                    raise UpscaleError(
                        f"step {step_no} exceeded timeout ({STEP_TIMEOUT_S:.0f}s) — 목표 크기를 줄여 보세요"
                    )
            if sharpen > 0:
                rgb = apply_unsharp(rgb, sharpen)
            alpha = cv2.resize(rgba[:, :, 3], (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LANCZOS4)
            rgba = np.dstack([rgb, alpha])
            del rgb, alpha
        else:
            interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4
            rgba = cv2.resize(rgba, (next_w, next_h), interpolation=interp)

        rgba = resize_exact(rgba, next_w, next_h)
        records.append(
            StepRecord(
                scale=scale,
                out_w=rgba.shape[1],
                out_h=rgba.shape[0],
                ms=int((time.perf_counter() - step_t0) * 1000),
            )
        )
        if checkpoint_dir is not None:
            ck = Path(checkpoint_dir)
            ck.mkdir(parents=True, exist_ok=True)
            (ck / f"step{step_no}.png").write_bytes(encode_image(rgba, "png", 1.0, dpi, False))
        if on_progress is not None:
            on_progress("step", step_no, len(chain), 1, 1)
        gc.collect()

    # 최종 FitMode 후처리 — CONTAIN은 투명 캔버스 중앙 배치(§4.2),
    # KEEP_RATIO/COVER/STRETCH는 정밀 리사이즈로 목표 치수에 맞춘다(§4.1 보정).
    if fit_mode == "CONTAIN" and (rgba.shape[1] != target_w or rgba.shape[0] != target_h):
        contain_scale = min(target_w / rgba.shape[1], target_h / rgba.shape[0])
        content = resize_exact(
            rgba,
            max(1, round(rgba.shape[1] * contain_scale)),
            max(1, round(rgba.shape[0] * contain_scale)),
        )
        canvas = np.zeros((target_h, target_w, 4), dtype=np.uint8)
        ox = (target_w - content.shape[1]) // 2
        oy = (target_h - content.shape[0]) // 2
        canvas[oy : oy + content.shape[0], ox : ox + content.shape[1]] = content
        rgba = canvas
        del content
    else:
        rgba = resize_exact(rgba, target_w, target_h)

    if on_progress is not None:
        on_progress("encode", len(chain), len(chain), 0, 1)
    payload = encode_image(rgba, fmt, quality, dpi, embed_dpi)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(payload)
    width_px, height_px = rgba.shape[1], rgba.shape[0]
    del payload, rgba
    gc.collect()
    if on_progress is not None:
        on_progress("encode", len(chain), len(chain), 1, 1)

    return UpscaleResult(
        output_path=str(out),
        width_px=width_px,
        height_px=height_px,
        duration_ms=int((time.perf_counter() - started) * 1000),
        steps=tuple(records),
    )
