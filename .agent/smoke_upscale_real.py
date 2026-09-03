# 실모델 E2E 스모크(커밋 금지·로컬 검증용) — resources/models/RealESRGAN_x4.onnx로
# server.upscale 디스패치 전 경로(세션 로딩·추론·알파·DPI 인코딩·진행 알림)를 확인한다.
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

os.environ["U2NET_HOME"] = str(Path(__file__).resolve().parent.parent / "resources" / "models")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "export-sidecar"))

import server  # noqa: E402

tmp = Path(tempfile.mkdtemp())
src = tmp / "in.png"
arr = np.zeros((60, 80, 4), dtype=np.uint8)
arr[..., 0] = np.linspace(30, 220, 80, dtype=np.uint8)[None, :]
arr[..., 1] = np.linspace(200, 40, 60, dtype=np.uint8)[:, None]
arr[..., 2] = 120
arr[..., 3] = 255
arr[:10, :10, 3] = 0  # 투명 영역 — 알파 보존 확인용
Image.fromarray(arr, "RGBA").save(src)

events: list[dict[str, object]] = []


def notifier(params: dict[str, object]) -> None:
    events.append(params)


response = server.handle_message(
    {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "upscale",
        "params": {
            "input_path": str(src),
            "output_path": str(tmp / "out.png"),
            "chain": [2.0],
            "target_w": 160,
            "target_h": 120,
            "dpi": 300,
            "sharpen": 0.3,
        },
    },
    notifier,
)
print("response:", response)
assert response is not None and "result" in response, response
result = response["result"]
assert (result["width_px"], result["height_px"]) == (160, 120), result

with Image.open(tmp / "out.png") as img:
    assert img.size == (160, 120)
    dpi_read = img.info.get("dpi")
    # pHYs는 정수 PPM(300dpi → 11811)으로 저장되므로 왕복 시 ±0.01dpi 오차
    assert dpi_read and abs(dpi_read[0] - 300.0) < 0.1, dpi_read
    out = np.asarray(img)
assert out.shape == (120, 160, 4)
assert out[0, 0, 3] == 0, "알파 보존 실패 — 좌상단 투명 영역 유지되어야 함"
assert out[60, 80, 3] == 255

stages = [e["stage"] for e in events]
assert "step" in stages and "encode" in stages, stages
print("progress stages:", stages)
print("steps:", result["steps"])

# --- anime 엔진 (RealESR-AnimeVideo-v3 x4) ---
response_anime = server.handle_message(
    {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "upscale",
        "params": {
            "input_path": str(src),
            "output_path": str(tmp / "out_anime.png"),
            "chain": [2.0],
            "target_w": 160,
            "target_h": 120,
            "dpi": 300,
            "model": "RealESR-AnimeVideo-x4",
            "sharpen": 0.3,
        },
    },
    notifier,
)
assert response_anime is not None and "result" in response_anime, response_anime
print("anime steps:", response_anime["result"]["steps"])

# --- 재개 (§5.3): [2, 2.5] 전체 실행 vs step1 체크포인트 재개 비교 ---
import upscale  # noqa: E402

tmp2 = Path(tempfile.mkdtemp())
src2 = tmp2 / "in2.png"
Image.fromarray(arr, "RGBA").save(src2)
ck = tmp2 / "ck"
full = upscale.process_file(src2, tmp2 / "full.png", [2.0, 2.5], 400, 300, dpi=300, checkpoint_dir=ck)
resumed = upscale.process_file(
    src2, tmp2 / "resumed.png", [2.0, 2.5], 400, 300, dpi=300,
    checkpoint_dir=ck, resume_from=ck / "step1.png", skip_steps=1,
)
assert len(resumed.steps) == 1 and resumed.steps[0].out_w == full.steps[1].out_w
with Image.open(tmp2 / "full.png") as fa, Image.open(tmp2 / "resumed.png") as fb:
    assert fa.size == fb.size == (400, 300)
    a, b = np.asarray(fa).astype(int), np.asarray(fb).astype(int)
    diff = np.abs(a - b).max()
assert diff <= 2, f"resume result diverges from full run: max diff {diff}"
print(f"resume equality: max pixel diff {diff} (<=2 OK)")
print("OK - real-model E2E passed")
