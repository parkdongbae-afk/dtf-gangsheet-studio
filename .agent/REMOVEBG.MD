DTF 인쇄 파이프라인 및 Python 사이드카 환경에 맞춘 배경 제거 통합 기술 명세서 `REMBG.MD`입니다.

---

### `REMBG.MD` 파일 내용

```markdown
# REMBG Background Removal Integration — DTF.agent

본 문서는 DTF 갱시트 엔진의 Python 사이드카(`export-sidecar`) 환경에 `rembg` 기반 배경 제거(누끼) 파이프라인을 추가하고, DTF 고해상도 인쇄 품질을 보장하기 위한 기술 스펙 및 구현 지침을 정의합니다.

---

## 1. 모델 선택 및 아키텍처

DTF 인쇄용 이미지의 배경 제거 시 고해상도 경계선 보존과 인쇄 테두리 번짐 방지가 핵심입니다.

- **기본 모델 (`isnet-general-use`)**:
  - 품질/속도 균형형(가중치 약 170MB). 앱 번들(resources/models)에 사전 포함해 첫 실행 다운로드 없이 즉시 동작.
- **초고정밀 옵션 (`birefnet-general`)**:
  - 피사체 경계면(머리카락, 텍스타일 외곽) 정밀도가 월등히 높은 SOTA(약 930MB). 로딩·추론이 무거워 고정밀 작업 시 선택적 사용.
- **최저사양 폴백 (`u2netp`)**:
  - 약 4MB — 저사양 기기·빠른 프리뷰용.

---

## 2. 의존성 및 패키지 설정

`uv` 패키지 매니저를 통해 사이드카 프로젝트에 필수 패키지를 등록합니다.

```bash
# 기본 ONNXRuntime CPU 버전
uv add rembg pillow opencv-python-headless numpy

# GPU(CUDA) 가속 필요 시 (선택)
uv add rembg[gpu]

```

### 오프라인 번들링 및 모델 캐싱 전략

운영 환경(프로덕션 패키징)에서 사용자가 매번 모델 라이브러리를 다운로드받지 않도록 사전에 캐싱 환경변수를 고정합니다.

* **환경변수 설정**: `U2NET_HOME` 설정하여 모델 가중치 경로 지정 — 패키지 앱은 번들 폴더(`resources/models`, 읽기 전용), 그 외는 userData(첫 사용 시 다운로드 후 재사용).
* **PyInstaller 번들 포함**: 빌드 시 ONNX 모델 파일이 리소스 폴더에 포함되도록 스펙 지정.

---

## 3. 고품질 32-bit RGBA & Defringe 파이프라인

JPG 이미지의 손실 압축으로 발생하는 **경계면 흰색 테두리(Fringe/Halo) 현상**을 Python 레벨에서 자동으로 제거하는 알파 채널 알파 다듬기 로직을 포함합니다.

```python
import io
import cv2
import numpy as np
from PIL import Image
from rembg import remove, new_session

# 기본 모델 세션 생성 (앱 구동 시 warmup 요청으로 1회 초기화)
bg_session = new_session("isnet-general-use")

def remove_background_dtf(input_image_bytes: bytes, defringe_px: int = 1) -> bytes:
    """
    JPG/PNG 입력 바이너리를 받아 배경을 제거하고,
    DTF 인쇄용 Defringe(테두리 다듬기)를 적용하여 32-bit RGBA PNG로 반환.
    """
    # 1. Rembg를 통한 배경 제거 (알파 채널 생성) — alpha_matting=False
    #    pymatting(CPU)은 수 GiB 단일 할당·배치 2건째 MemoryError(2026-09-03 실측)와
    #    속도 병목의 원인. 모델 마스크를 직용하고 경계 다듬기는 apply_dtf_defringe가 담당.
    output_bytes = remove(
        input_image_bytes,
        session=bg_session,
        alpha_matting=False
    )
    
    # 2. PIL Image 변환
    img = Image.open(io.BytesIO(output_bytes)).convert("RGBA")
    
    # 3. Defringe (흰색 테두리 침식 및 색상 번짐 보정)
    if defringe_px > 0:
        img = apply_dtf_defringe(img, erode_px=defringe_px)
        
    output_buffer = io.BytesIO()
    img.save(output_buffer, format="PNG", compress_level=1)
    return output_buffer.getvalue()

def apply_dtf_defringe(img: Image.Image, erode_px: int = 1) -> Image.Image:
    """
    알파 채널의 경계를 N픽셀 침식(Erode)시켜 JPG 압축 흰색 노이즈 제거
    """
    np_img = np.array(img)
    r, g, b, alpha = cv2.split(np_img)
    
    # 알파 커널 침식
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_px * 2 + 1, erode_px * 2 + 1))
    eroded_alpha = cv2.erode(alpha, kernel, iterations=1)
    
    # 알파 채널 재합성
    result_np = cv2.merge([r, g, b, eroded_alpha])
    return Image.fromarray(result_np, "RGBA")

```

---

## 4. 인쇄 품질 유지 핵심 체크리스트

1. **32-bit RGBA 유지**: 색상 공간을 RGB로 강제 변환 시 알파 채널이 유실되므로, 반드시 `RGBA` 형태를 보존하여 PNG 바이너리로 전달합니다.
2. **Post-Processing Defringe**: JPG 원본 이미지 특성상 배경 제거 후 1px 내외의 배경 색상 테두리가 남으므로, OpenCV 침식 연산(`cv2.erode`)을 통해 알파 경계를 1px 미세 축소하여 인쇄물 오염을 차단합니다.
3. **IPC JSON-RPC 통신 규격**:
* Node.js/Electron 메인 프로세스로부터 이미지 Base64 스트림 수신.
* 배경 제거 처리 후 RGBA PNG Base64 반환 및 메모리 수거(`gc.collect()`).



---

## 5. 성능 및 메모리 최적화 규칙

* **세션 캐싱 (Session Caching)**: `new_session()` 함수는 모델 파일 로딩으로 인해 비용이 매우 크므로 파이썬 프로세스 구동 시 전역 변수로 1회만 생성하여 재사용합니다.
* **메모리 피크 관리**: 고해상도(4K 이상) 이미지 수신 시 메모리가 순간 급증하므로 처리 후 `del np_img` 및 `gc.collect()`를 명시적으로 실행합니다.

```

---

### 터미널 생성 명령어

터미널이나 CLI 환경에서 아래 단일 명령어를 실행하면 `REMBG.MD` 파일이 프로젝트 루트에 즉시 작성됩니다.

```bash
cat << 'EOF' > REMBG.MD
# REMBG Background Removal Integration — DTF.agent

본 문서는 DTF 갱시트 엔진의 Python 사이드카(`export-sidecar`) 환경에 `rembg` 기반 배경 제거(누끼) 파이프라인을 추가하고, DTF 고해상도 인쇄 품질을 보장하기 위한 기술 스펙 및 구현 지침을 정의합니다.

---

## 1. 모델 선택 및 아키텍처

DTF 인쇄용 이미지의 배경 제거 시 고해상도 경계선 보존과 인쇄 테두리 번짐 방지가 핵심입니다.

- **기본 모델 (`isnet-general-use`)**:
  - 품질/속도 균형형(가중치 약 170MB). 앱 번들(resources/models)에 사전 포함해 첫 실행 다운로드 없이 즉시 동작.
- **초고정밀 옵션 (`birefnet-general`)**:
  - 피사체 경계면(머리카락, 텍스타일 외곽) 정밀도가 월등히 높은 SOTA(약 930MB). 로딩·추론이 무거워 고정밀 작업 시 선택적 사용.
- **최저사양 폴백 (`u2netp`)**:
  - 약 4MB — 저사양 기기·빠른 프리뷰용.

---

## 2. 의존성 및 패키지 설정

`uv` 패키지 매니저를 통해 사이드카 프로젝트에 필수 패키지를 등록합니다.

```bash
# 기본 ONNXRuntime CPU 버전
uv add rembg pillow opencv-python-headless numpy

# GPU(CUDA) 가속 필요 시 (선택)
uv add rembg[gpu]

```

### 오프라인 번들링 및 모델 캐싱 전략

운영 환경(프로덕션 패키징)에서 사용자가 매번 모델 라이브러리를 다운로드받지 않도록 사전에 캐싱 환경변수를 고정합니다.

* **환경변수 설정**: `U2NET_HOME` 설정하여 모델 가중치 경로 지정 — 패키지 앱은 번들 폴더(`resources/models`, 읽기 전용), 그 외는 userData(첫 사용 시 다운로드 후 재사용).
* **PyInstaller 번들 포함**: 빌드 시 ONNX 모델 파일이 리소스 폴더에 포함되도록 스펙 지정.

---

## 3. 고품질 32-bit RGBA & Defringe 파이프라인

JPG 이미지의 손실 압축으로 발생하는 **경계면 흰색 테두리(Fringe/Halo) 현상**을 Python 레벨에서 자동으로 제거하는 알파 채널 알파 다듬기 로직을 포함합니다.

```python
import io
import cv2
import numpy as np
from PIL import Image
from rembg import remove, new_session

# 기본 모델 세션 생성 (앱 구동 시 warmup 요청으로 1회 초기화)
bg_session = new_session("isnet-general-use")

def remove_background_dtf(input_image_bytes: bytes, defringe_px: int = 1) -> bytes:
    """
    JPG/PNG 입력 바이너리를 받아 배경을 제거하고,
    DTF 인쇄용 Defringe(테두리 다듬기)를 적용하여 32-bit RGBA PNG로 반환.
    """
    # 1. Rembg를 통한 배경 제거 (알파 채널 생성) — alpha_matting=False
    #    pymatting(CPU)은 수 GiB 단일 할당·배치 2건째 MemoryError(2026-09-03 실측)와
    #    속도 병목의 원인. 모델 마스크를 직용하고 경계 다듬기는 apply_dtf_defringe가 담당.
    output_bytes = remove(
        input_image_bytes,
        session=bg_session,
        alpha_matting=False
    )
    
    # 2. PIL Image 변환
    img = Image.open(io.BytesIO(output_bytes)).convert("RGBA")
    
    # 3. Defringe (흰색 테두리 침식 및 색상 번짐 보정)
    if defringe_px > 0:
        img = apply_dtf_defringe(img, erode_px=defringe_px)
        
    output_buffer = io.BytesIO()
    img.save(output_buffer, format="PNG", compress_level=1)
    return output_buffer.getvalue()

def apply_dtf_defringe(img: Image.Image, erode_px: int = 1) -> Image.Image:
    """
    알파 채널의 경계를 N픽셀 침식(Erode)시켜 JPG 압축 흰색 노이즈 제거
    """
    np_img = np.array(img)
    r, g, b, alpha = cv2.split(np_img)
    
    # 알파 커널 침식
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_px * 2 + 1, erode_px * 2 + 1))
    eroded_alpha = cv2.erode(alpha, kernel, iterations=1)
    
    # 알파 채널 재합성
    result_np = cv2.merge([r, g, b, eroded_alpha])
    return Image.fromarray(result_np, "RGBA")

```

---

## 4. 인쇄 품질 유지 핵심 체크리스트

1. **32-bit RGBA 유지**: 색상 공간을 RGB로 강제 변환 시 알파 채널이 유실되므로, 반드시 `RGBA` 형태를 보존하여 PNG 바이너리로 전달합니다.
2. **Post-Processing Defringe**: JPG 원본 이미지 특성상 배경 제거 후 1px 내외의 배경 색상 테두리가 남으므로, OpenCV 침식 연산(`cv2.erode`)을 통해 알파 경계를 1px 미세 축소하여 인쇄물 오염을 차단합니다.
3. **IPC JSON-RPC 통신 규격**:
* Node.js/Electron 메인 프로세스로부터 이미지 Base64 스트림 수신.
* 배경 제거 처리 후 RGBA PNG Base64 반환 및 메모리 수거(`gc.collect()`).



---

## 5. 성능 및 메모리 최적화 규칙

* **세션 캐싱 (Session Caching)**: `new_session()` 함수는 모델 파일 로딩으로 인해 비용이 매우 크므로 파이썬 프로세스 구동 시 전역 변수로 1회만 생성하여 재사용합니다.
* **메모리 피크 관리**: 고해상도(4K 이상) 이미지 수신 시 메모리가 순간 급증하므로 처리 후 `del np_img` 및 `gc.collect()`를 명시적으로 실행합니다.
EOF

```

```