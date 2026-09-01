"""배경 제거(누끼) 파이프라인 — v2 (.agent/REMOVEBG.MD 스펙 기반).

DTF 인쇄 품질을 위한 두 가지 후처리 철칙(REMOVEBG.MD §4):

1. **32-bit RGBA 보존** — 알파 채널이 곧 백색 잉크 영역이다. RGB 강제 변환·
   JPG 재인코딩 금지, 출력은 PNG 바이너리만.
2. **Post-Processing Defringe** — JPG 손실 압축이 만드는 경계면 흰색
   테두리(Fringe/Halo)를 OpenCV 알파 침식(``cv2.erode``)으로 1px 내외
   미세 축소해 인쇄물 오염을 차단한다.

스펙 대비 조정(프로젝트 STDIO_GUIDE 철칙 준수):

- 스펙의 "앱 시작 시 세션 생성" → **첫 ``remove_bg`` 요청 시 lazy 생성**.
  ``new_session()``은 모델 가중치 로딩(수백 MB)이 동반되므로, export 전용
  스폰에서 배경 제거 미사용 시 비용이 0이 되어야 한다. 생성은 모델명별
  1회만 캐싱해 재사용한다(REMOVEBG.MD §5 세션 캐싱 규칙은 그대로 준수).
- rembg 2.0.81은 pymatting이 기본 의존성이라 스펙의 alpha_matting 파라미터를
  그대로 사용한다.
"""

from __future__ import annotations

import gc
import io
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

if TYPE_CHECKING:
    from rembg.sessions import BaseSession

# 추천 기본 모델 — u2net 대비 경계면(머리카락·텍스타일 외곽) 정밀도가 월등한 SOTA (REMOVEBG.MD §1)
DEFAULT_MODEL: str = "birefnet-general"
# 경량 폴백 후보(빠른 프리뷰·저메모리): "u2netp", "isnet-general-use"
FALLBACK_MODELS: tuple[str, ...] = ("u2netp", "isnet-general-use")

# 기본 Defringe 강도(px) — 0이면 후처리 생략
DEFAULT_DEFRINGE_PX: int = 1

# alpha_matting 파라미터 (REMOVEBG.MD §3 스펙값 그대로)
ALPHA_MATTING_FOREGROUND_THRESHOLD: int = 240
ALPHA_MATTING_BACKGROUND_THRESHOLD: int = 10
ALPHA_MATTING_ERODE_SIZE: int = 10

# PNG 압축 레벨 — 속도 우선(검수·재편집용 산출물, 무손실은 PNG 자체가 보장)
PNG_COMPRESS_LEVEL: int = 1


class RemoveBgError(Exception):
    """배경 제거 입력 문제 — 서버에서 INVALID_PARAMS(-32602)로 매핑한다."""


@dataclass(frozen=True)
class RemoveBgResult:
    """처리 결과 — PNG 바이너리와 치수(입력과 동일, 응답은 메타데이터만)."""

    png: bytes
    width_px: int
    height_px: int


# 모델명 → 로딩된 세션. 프로세스 생애 동안 유지(세션 캐싱, REMOVEBG.MD §5).
_sessions: dict[str, BaseSession] = {}


def get_session(model: str) -> BaseSession:
    """rembg 세션 조회 — 미로딩 모델만 ``new_session()`` 1회 생성 후 캐싱.

    rembg 임포트도 이 시점에 처음 수행한다(export 스폰 경로와 결합 0).
    모델 가중치는 ``U2NET_HOME``(없으면 ~/.u2net)에서 찾고 없으면 다운로드한다.
    """
    session = _sessions.get(model)
    if session is None:
        from rembg import new_session

        session = new_session(model)
        _sessions[model] = session
    return session


def remove_background_dtf(
    input_bytes: bytes, session: BaseSession, defringe_px: int = DEFAULT_DEFRINGE_PX
) -> RemoveBgResult:
    """입력 이미지 바이너리 → 배경 제거 + Defringe → 32-bit RGBA PNG 결과.

    alpha_matting으로 경계를 부드럽게 다듬고(REMOVEBG.MD §3 스펙 파라미터),
    이후 알파 경계를 ``defringe_px``만큼 침식시켜 흰색 테두리를 제거한다.
    고해상도 처리 직후 ``del`` + ``gc.collect()``로 메모리 피크를 수거한다(§5).
    """
    from rembg import remove

    try:
        raw: object = remove(
            input_bytes,
            session=session,
            alpha_matting=True,
            alpha_matting_foreground_threshold=ALPHA_MATTING_FOREGROUND_THRESHOLD,
            alpha_matting_background_threshold=ALPHA_MATTING_BACKGROUND_THRESHOLD,
            alpha_matting_erode_size=ALPHA_MATTING_ERODE_SIZE,
        )
        # rembg remove()의 반환 어노테이션은 입력 타입별 유니온 — bytes 입력은 bytes 반환
        if not isinstance(raw, bytes):
            raise RemoveBgError(f"unexpected rembg output type: {type(raw).__name__}")
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
    except (UnidentifiedImageError, ValueError, OSError) as exc:
        # 디코드 불가 입력 — 클라이언트 문제(INVALID_PARAMS)로 분류
        raise RemoveBgError(f"cannot decode input image: {exc}") from exc
    del raw  # 원본·rembg 출력 버퍼 이중 상태 해소

    try:
        if defringe_px > 0:
            img = apply_dtf_defringe(img, erode_px=defringe_px)
        buffer = io.BytesIO()
        img.save(buffer, format="PNG", compress_level=PNG_COMPRESS_LEVEL)
        return RemoveBgResult(
            png=buffer.getvalue(), width_px=img.width, height_px=img.height
        )
    finally:
        img.close()
        gc.collect()  # 4K+ 입력의 순간 메모리 피크 수거 (REMOVEBG.MD §5)


def apply_dtf_defringe(img: Image.Image, erode_px: int = DEFAULT_DEFRINGE_PX) -> Image.Image:
    """알파 채널 경계를 N px 타원 커널로 침식 — JPG 압축 흰색 노이즈 제거.

    RGB 채널은 건드리지 않고 알파만 침식해 재합성한다(색상 불변).
    """
    np_img = np.array(img)
    r, g, b, alpha = cv2.split(np_img)
    del np_img

    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (erode_px * 2 + 1, erode_px * 2 + 1)
    )
    eroded_alpha = cv2.erode(alpha, kernel, iterations=1)
    return Image.fromarray(cv2.merge([r, g, b, eroded_alpha]), "RGBA")


def process_file(
    input_path: str | Path,
    output_path: str | Path,
    model: str = DEFAULT_MODEL,
    defringe_px: int = DEFAULT_DEFRINGE_PX,
) -> RemoveBgResult:
    """파일→파일 처리기 — server.py ``remove_bg`` 메서드 본문.

    입력 문제(파일 없음·디코딩 실패)는 :class:`RemoveBgError`로, 그 외 추론
    실패는 그대로 전파해 서버가 INTERNAL_ERROR로 매핑하게 한다.
    """
    src = Path(input_path)
    if not src.is_file():
        raise RemoveBgError(f"input file not found: {src}")
    if defringe_px < 0:
        raise RemoveBgError(f"defringe_px must be >= 0: {defringe_px}")

    try:
        session = get_session(model)
    except Exception as exc:  # 모델명 오류·가중치 다운로드 실패 — 안내 가능한 입력 문제
        raise RemoveBgError(f"model load failed ({model}): {type(exc).__name__}: {exc}") from exc

    data = src.read_bytes()
    result = remove_background_dtf(data, session, defringe_px)
    del data

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(result.png)
    return result
