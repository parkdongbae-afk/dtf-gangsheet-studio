# SKILL.md — 개발자 및 AI 기술 역량 표준 규격서

본 문서는 **DTF GangSheet Studio** 프로젝트 개발에 필요한 핵심 기술 스택, 알고리즘, 도메인 지식,
개발 프로세스 및 검증 절차를 정의합니다.

---

## 1. 도메인 지식 (Domain Knowledge)

### 1.1 DTF (Direct-to-Film) 전사 인쇄 이해
- **White Underbase (백색 하도)**: 투명 알파 채널이 있는 영역에 백색 잉크를 먼저 분사한 후
  CMYK를 출력하는 방식. **알파 채널 = 백색 잉크 영역**이므로 투명 배경 PNG의 알파 채널 훼손 금지
  (JPG 재저장 등으로 인한 알파 유실 절대 금지).
- **Gang Sheet (합판 배치)**: 폭 50cm의 필름 롤에 다양한 크기의 디자인을 여백을 최적화하여
  1m~2m 단위로 모아 인쇄하는 방식.
- **업체 납품 스펙**: CMYK / 350 DPI / PSD(레이어 보존).

### 1.2 DPI 및 실사 크기 계산
- 1 inch = 2.54 cm, `px = round(cm ÷ 2.54 × 350)`

| 실물 크기 | 픽셀 | 비고 |
|---|---|---|
| 폭 50cm | 6,890 | 고정 |
| 높이 1m | 13,780 | 프리셋 A |
| 높이 2m | 27,559 | 프리셋 B — **PSD 한계(변당 30,000px) 이내 최대** |
| 높이 3m | 41,339 | **PSD 저장 불가** — 반드시 2m 단위 분할 |

---

## 2. 핵심 개발 스킬 세트 (Required Technical Skills)

### 2.1 대용량 그래픽 캔버스 및 렌더링 성능 최적화
- 6,890 × 13,780 px RGB 비트맵은 약 285MB, 2m(27,559px) 문서는 약 570MB —
  풀해상도를 메모리에 직접 상주시키면 OOM 발생.
- **Viewport Proxy Rendering**: 화면 조작은 72~96 DPI 저해상도 **프록시 캔버스**(Konva.js)로 수행.
- **내보내기 시에만** 350 DPI 풀 파이프라인 가동(Python 사이드카 워커).
- 이미지 원본은 디스크에 보관하고, 씬에는 축소 프리뷰(≤2,048px)만 올린다.

### 2.2 CMYK 및 색상 관리 (Color Management)
- 에디터 캔버스는 항상 **RGB로 편집**. RGB→CMYK 변환은 **내보내기 시 1회만** 수행
  (반복 변환은 색 오차를 누적시킨다).
- 변환 엔진: `ImageCms`(lcms2/LittleCMS 바인딩) `profileToProfile`
  — sRGB/AdobeRGB → FOGRA39 / Japan Color 2001 / US Web Coated SWOP.
- 폴백 수식 변환(`K=1-max`, `C=(1-R-K)/(1-K)` …)은 색 오차가 있으므로 검수 후에만 사용.

### 2.3 PSD 구조 생성 및 파싱 (PSD File Binary Manipulation)
- 헤더 Color Mode Index: **`4` = CMYK (주의: `3` = RGB — 혼동 금지)**.
- 해상도: Image Resource **ID 1005 (`0x03ED`) ResolutionInfo** 블록에 350 DPI 고정소수점 기록.
- 레이어 데이터: 캔버스 밖 픽셀도 보존됨(음수 좌표 허용) — 화면 채우기로 캔버스 밖에 나간
  부분이 잘리지 않는다.
- **쓰기 엔진 제약 (검증된 사실)**:
  - `ag-psd`(npm): 읽기는 다수 색 모드 지원, **쓰기는 RGB 전용**(공식 README 명시) →
    CMYK PSD 저장에 사용 금지. 읽기·구조 참고용으로만.
  - `psd-tools`(Python): `PSDImage.new(mode='CMYK')` + `create_pixel_layer()` + `save()`로
    레이어 CMYK PSD 생성 지원(공식 문서, '실험적' 표기) → **M0 스파이크에서 실증 검증 필수**.
- CMYK 문서에서 레이어 알파 채널은 픽셀 마스크(USER_LAYER_MASK)로 저장됨 —
  Photoshop에서 레이어 마스크로 표시되며 기능적으로 동등.

---

## 3. 크로스 개발 환경 역량 (School-Home Sync)
- **GitHub 단일 진실 원점 준수** — 작업 시작 전 `git pull`, 종료 전 `git push`.
- Git 브랜치 전략·Git LFS·Dev Container 규격은 `CLOUD.md`를 준수할 것.
- 코드 내 OS 절대 경로 사용 금지 — `path.resolve`(Node) / `pathlib`(Python) 사용.
- **PSD 개봉 검증(Photoshop)은 로컬 Windows에서만 가능** — Codespaces/컨테이너에는 Photoshop이 없음.

---

## 4. 검증 체크리스트 (커밋/PR 전 필수)

- [ ] 에디터: `npm run lint` / `npm run typecheck` / `npm test` 통과
- [ ] 사이드카: `ruff check` / `pyright` / `pytest` 통과
- [ ] 생성 PSD를 Photoshop으로 개봉 확인:
  - [ ] 문서 정보 = CMYK / 350 DPI / 크기 일치 (예: 6,890×13,780px = 50×100cm)
  - [ ] 레이어 구조 및 투명부(알파) 보존
  - [ ] 이동·크기·회전·복제·화면 채우기 결과가 화면과 일치
- [ ] 2m(27,559px) 문서 저장 성공 및 메모리 크래시 없음
- [ ] 캔버스 밖 레이어 픽셀 손실 없음

---

## 5. 용어 사전 (Glossary)

| 용어 | 설명 |
|---|---|
| DTF | Direct To Film — PET 필름 출력 후 열압착 전사 방식 |
| 갱시트(Gang Sheet) | 필름 롤에 디자인을 모아 배치한 인쇄 원고 |
| White Underbase | 알파 영역에 먼저 뿌리는 백색 잉크 층 |
| CMYK | 인쇄 4색 (Cyan/Magenta/Yellow/Key) |
| PSD | Photoshop Document — 레이어 보존, 변당 최대 30,000px |
| 프록시 렌더링 | 화면 조작용 저해상도 캔버스, 내보내기 시 원해상도 렌더 |
| cover / contain | 캔버스를 가득 채우는 스케일 / 캔버스 안에 맞추는 스케일 |
