# Auto-Nesting Engine Specification — DTF.agent

본 문서는 DTF 갱시트 필름 내 이미지 패킹 밀도를 극대화하고 여백 낭비를 최소화하기 위한 **자동 배치(Auto-Nesting / Bin Packing) 알고리즘** 및 UI/UX 구현 지침을 정의합니다.

---

## 1. 핵심 요구사항 & 기능 스펙

1. **상단 밀집 배치 (Top-to-Bottom Tight Packing)**
   - 캔버스 상단부터 빈 공간을 찾아 이미지들을 차곡차곡 밀집 배치하여 총 수직 길이(높이) 및 필름 낭비를 최소화.
2. **동적 간격 조절 (Adjustable Gap)**
   - 기본 간격: **`2.0 cm` (기본값)**
   - 설정 가능 범위: `0.0 cm` ~ `10.0 cm` (0.1 cm 단위 조정)
   - 350 DPI 고해상도 픽셀 변환 공식 적용.
3. **회전 패킹 옵션 (Allow 90° Rotation)**
   - 이미지를 90도 회전 시 공간 효율이 더 좋아질 경우 자동 회전 배치 허용 옵션 (Toggle).
4. **Zustand & Konva 동기화 및 Undo 지원**
   - 배치 결과 적용 시 기존 위치 정보를 Zustand History에 저장하여 `Ctrl + Z` 복구 지원.

---

## 2. 알고리즘 채택: MaxRects (Maximal Rectangles)

2D 패킹 문제 중 속도와 공간 효율성이 가장 뛰어난 **MaxRects (BAF: Best Area Fit / BSF: Best Short Side Fit)** 알고리즘을 사용합니다.

- **작동 원리**:
  1. 배치할 이미지 목록을 크기(면적/긴 변) 순으로 내림차순 정렬.
  2. 캔버스 가로 영역(예: 60cm) 내에서 각 이미지가 들어갈 수 있는 최적의 빈 공간(Free Rectangle) 탐색.
  3. 이미지 둘레에 설정된 간격(`Gap / 2`)만큼 패딩 마진을 부여하여 배치.
  4. 배치 완료 후 캔버스 전체 수직 높이를 최적 위치로 자라냄(Bounding Crop).

---

## 3. 단위 변환 및 패딩 산출 로직

350 DPI 기준 픽셀(px) 변환 공식:

$$\text{Gap}_{px} = \text{Gap}_{cm} \times \left(\frac{350}{2.54}\right) \approx \text{Gap}_{cm} \times 137.795$$

- **기본 간격 (2.0 cm)** = 약 `275.59 px`
- **배치 계산 시 각 이미지 박스 확장 계산**:
  - Effective Width = $\text{Width} + \text{Gap}_{px}$
  - Effective Height = $\text{Height} + \text{Gap}_{px}$

---

## 4. 데이터 구조 및 모듈 인터페이스 (TypeScript)

`src/utils/autoNesting.ts` 패키징 모듈 인터페이스 정의:

```typescript
export interface NestingOptions {
  canvasWidthPx: number;      // 캔버스 가로 폭 (px)
  canvasHeightPx: number;     // 캔버스 최대 허용 높이 (px)
  gapCm: number;              // 이미지 간격 (기본값: 2.0)
  dpi: number;                // DPI (기본값: 350)
  allowRotation: boolean;     // 90도 회전 배치 허용 여부
}

export interface CanvasItem {
  id: string;
  x: number;
  y: number;
  width: number;              // px
  height: number;             // px
  rotation: number;           // deg (0 or 90)
}

export interface NestingResult {
  packedItems: CanvasItem[];
  usedHeightPx: number;       // 사용된 최종 수직 높이
  efficiency: number;         // 공간 효율 (%)
}