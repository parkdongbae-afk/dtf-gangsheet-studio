"""투명 여백 자동 트림(Auto-Trim) — PNG 임포트 시 알파 바운딩 박스 크롭.

문제: 누끼(PNG) 원본은 피사체 외곽에 넓은 투명 여백을 포함하는 경우가 많다.
이 여백도 항목 크기로 계산되어 복제·정렬·자동 배치에서 실제 피사체보다
레이아웃 간격이 벌어진다. 임포트 시점에 알파 채널의 불투명 픽셀 바운딩 박스
(x_min, y_min, x_max, y_max)만 남기면 이후 모든 편집이 실제 피사체 기준이 된다.

계약 (REMOVEBG.MD §4 원칙 계승):

1. **알파 임계값** — 배경 제거 결과 가장자리에는 눈에 보이지 않는 알파 1~5
   수준의 옅은 잔상이 남아 바운딩 박스가 과대 계산된다. ``alpha > threshold``
   픽셀만 보이는 픽셀로 간주한다(기본 임계값 10 — 잔상은 투명 취급).
2. **no-op은 에러가 아니다** — 완전 투명(보이는 픽셀 0개)·여백 없음(bbox=
   캔버스 전체)·알파 없는 포맷(JPG 등 — RGBA 강제 시 전면 불투명)은
   ``trimmed=False``로 원본 경로·치수를 그대로 돌려주고 파일을 만들지 않는다.
3. **RGBA·물리 DPI 보존** — 픽셀은 crop만 수행(재변환 손실 없음)하고 PNG
   pHYs DPI를 출력에 이어 쓴다(임포트 물리 크기 보존 — imageMeta.ts
   physicalDocPixels와 대응, 임계값 상수는 src/core/autoTrim.ts와 동기).

성능: bbox 스캔은 numpy 벡터 연산(행·열 ``any`` 축소 2회 — 픽셀당 상수 비용,
50cm×2m 래스터도 수십 ms). 본 모듈은 사이드카 프로세스에서 실행되므로
Electron 메인·렌더러 스레드를 지연시키지 않는다(STDIO_GUIDE 프로세스 분리).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, UnidentifiedImageError

# 보이는 픽셀 판정 임계값 — alpha > threshold만 불투명 취급(잔상 1~5 무시).
# src/core/autoTrim.ts AUTO_TRIM_ALPHA_THRESHOLD와 동기 유지.
DEFAULT_ALPHA_THRESHOLD: int = 10
MAX_ALPHA_THRESHOLD: int = 254  # 255면 모든 픽셀이 투명 취급이 되어 금지

# PNG 압축 레벨 — removebg.py와 동일 정책(속도 우선, 무손실은 PNG 자체가 보장)
PNG_COMPRESS_LEVEL: int = 1


class AutoTrimError(Exception):
    """자동 트림 입력 문제 — 서버에서 INVALID_PARAMS(-32602)로 매핑한다."""


@dataclass(frozen=True)
class AutoTrimResult:
    """처리 결과 — no-op이면 output_path=원본 경로, trimmed=False."""

    output_path: str
    width_px: int
    height_px: int
    trimmed: bool


def alpha_bbox(
    img: Image.Image, threshold: int = DEFAULT_ALPHA_THRESHOLD
) -> tuple[int, int, int, int] | None:
    """알파 > threshold 픽셀의 최외각 바운딩 박스 (left, top, right, bottom).

    right·bottom은 반개구간(PIL ``crop`` 좌표계 그대로 — width = right-left).
    임계값을 넘는 픽셀이 하나도 없으면 None(완전 투명).
    """
    alpha = np.asarray(img.getchannel("A"))
    rows = np.flatnonzero((alpha > threshold).any(axis=1))
    if rows.size == 0:
        return None
    cols = np.flatnonzero((alpha > threshold).any(axis=0))
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def auto_trim_file(
    input_path: str | Path,
    output_path: str | Path,
    alpha_threshold: int = DEFAULT_ALPHA_THRESHOLD,
) -> AutoTrimResult:
    """파일→파일 트림 처리기 — server.py ``auto_trim`` 메서드 본문.

    입력 문제(파일 없음·디코딩 실패·임계값 범위 위반)는 :class:`AutoTrimError`로
    던져 서버가 INVALID_PARAMS로 매핑하게 한다. no-op(트림 불가·무의미)은
    예외 없이 ``trimmed=False`` 원본 응답 — 기능 장애가 아니기 때문.
    """
    src = Path(input_path)
    if not src.is_file():
        raise AutoTrimError(f"input file not found: {src}")
    if isinstance(alpha_threshold, bool) or not (
        0 <= alpha_threshold <= MAX_ALPHA_THRESHOLD
    ):
        raise AutoTrimError(
            f"alpha_threshold must be an int in 0..{MAX_ALPHA_THRESHOLD}, got {alpha_threshold!r}"
        )

    try:
        with Image.open(src) as opened:
            rgba = opened.convert("RGBA")  # 알파 없는 포맷은 전면 불투명 → no-op
            source_dpi = rgba.info.get("dpi")
            bbox = alpha_bbox(rgba, alpha_threshold)
            if bbox is None:
                # 완전 투명 — 크롭 불가, 원본 유지(에러 아님)
                return AutoTrimResult(str(src), rgba.width, rgba.height, False)
            left, top, right, bottom = bbox
            if (left, top) == (0, 0) and (right, bottom) == (rgba.width, rgba.height):
                # 여백 없음 — 이미 바운딩 박스가 캔버스 전체
                return AutoTrimResult(str(src), rgba.width, rgba.height, False)
            cropped = rgba.crop((left, top, right, bottom))
            out = Path(output_path)
            out.parent.mkdir(parents=True, exist_ok=True)
            save_kwargs: dict[str, object] = {"compress_level": PNG_COMPRESS_LEVEL}
            if isinstance(source_dpi, tuple) and len(source_dpi) == 2:
                save_kwargs["dpi"] = source_dpi  # pHYs 물리 크기 보존
            cropped.save(out, format="PNG", **save_kwargs)
    except (UnidentifiedImageError, OSError) as exc:
        raise AutoTrimError(f"cannot decode input image: {exc}") from exc

    return AutoTrimResult(str(out), cropped.width, cropped.height, True)
