# 기능 업데이트 기술 문서 (tech.md)

## 1. 개요 (Overview)
본 문서는 이미지 편집 및 캔버스 프로그램의 기능 고도화를 위한 기술 사양서입니다.  
요청하신 **마우스 드래그를 이용한 영역 선택 (부분 교차 감지)**, **Ctrl + 클릭 다중/토글 선택**, 그리고 **선택된 이미지 객체 정렬 (Alignment)** 기능의 아키텍처 및 구현 가이드를 포함합니다.

---

## 2. 주요 기능 요구사항 (Requirements)

### 2.1. 드래그 영역 선택 (Marquee Drag Selection)
- **부분 교차 감지 (Partial Overlap / AABB Intersection)**: 마우스 드래그 선택 영역(Bounding Box)에 이미지의 일부분만 접촉하거나 교차하더라도 즉시 해당 이미지가 선택 대상에 포함되어야 함.
- **시각적 피드백**: 마우스 드래그 중 실시간으로 선택 영역 박스(반투명 점선/실선 사각형)를 렌더링.

### 2.2. Ctrl + 클릭 개별 토글 선택 (Toggle Selection)
- `Ctrl` (macOS: `Cmd`) 키를 누른 상태에서 이미지 클릭 시:
  - **이미 선택된 이미지**: 선택 해제 (Deselect)
  - **선택되지 않은 이미지**: 기존 선택 상태를 유지하면서 해당 이미지를 추가 선택 (Add to Selection)
- `Ctrl` 키 없이 빈 공간 클릭 시: 모든 선택 해제 (Clear Selection)
- `Ctrl` 키 없이 특정 이미지 클릭 시: 해당 이미지만 단일 선택 (Single Select)

### 2.3. 선택된 이미지 정렬 기능 (Image Alignment & Distribution)
- 2개 이상의 선택된 이미지가 존재할 때 정렬 연산 수행.
- 지원 정렬 옵션:
  - **좌측 정렬 (Align Left)**
  - **우측 정렬 (Align Right)**
  - **상단 정렬 (Align Top)**
  - **하단 정렬 (Align Bottom)**
  - **수평 중앙 정렬 (Align Center Horizontal)**
  - **수직 중앙 정렬 (Align Center Vertical)**
  - **수평 간격 균등 분배 (Distribute Horizontally)** (권장 옵션)
  - **수직 간격 균등 분배 (Distribute Vertically)** (권장 옵션)

---

## 3. 데이터 구조 및 상태 정의 (Data Structure & State)

```typescript
// 이미지 객체 인터페이스
interface ImageObject {
  id: string;
  x: number;      // 좌상단 X 좌표
  y: number;      // 좌상단 Y 좌표
  width: number;  // 너비
  height: number; // 높이
  zIndex?: number;
}

// 선택 영역 바운딩 박스
interface SelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

// 글로벌 캔버스 상태
interface CanvasState {
  images: ImageObject[];
  selectedIds: Set<string>; // 선택된 이미지 ID의 집합
  selectionBox: SelectionBox | null;
  isDraggingSelection: boolean;
}
```

---

## 4. 핵심 알고리즘 및 구현 상세 (Core Logic & Mathematics)

### 4.1. 충돌 감지 알고리즘 (AABB Intersection Check)
드래그 영역 사각형 $R_{drag}$와 이미지 사각형 $R_{img}$ 간의 교차 여부는 **AABB (Axis-Aligned Bounding Box)** 충돌 알고리즘을 사용합니다.  
두 사각형이 **전혀 겹치지 않을 조건**의 여집합을 취하면, **부분 교차(Partial Overlap)**를 완벽하게 감지할 수 있습니다.

#### 교차 조건 식:
$$Overlap(R_{drag}, R_{img}) = 
eg (R_{drag}.right < R_{img}.left \lor R_{drag}.left > R_{img}.right \lor R_{drag}.bottom < R_{img}.top \lor R_{drag}.top > R_{img}.bottom)$$

#### JavaScript 구현 예시:
```javascript
function isIntersecting(selectionBox, img) {
  // 드래그 방향에 상관없이 Normalized 좌표 계산
  const dragLeft = Math.min(selectionBox.startX, selectionBox.currentX);
  const dragRight = Math.max(selectionBox.startX, selectionBox.currentX);
  const dragTop = Math.min(selectionBox.startY, selectionBox.currentY);
  const dragBottom = Math.max(selectionBox.startY, selectionBox.currentY);

  const imgLeft = img.x;
  const imgRight = img.x + img.width;
  const imgTop = img.y;
  const imgBottom = img.y + img.height;

  // 교차하지 않는 경우의 반대(NOT)
  return !(
    dragRight < imgLeft ||
    dragLeft > imgRight ||
    dragBottom < imgTop ||
    dragTop > imgBottom
  );
}
```

---

### 4.2. 이벤트 처리 및 상태 전환 (Event Handling Flow)

```
[MouseDown Event]
 ├── 이미지 클릭?
 │    ├── Ctrl 누름 -> selectedIds.has(id) ? delete(id) : add(id)
 │    └── Ctrl 안누름 -> selectedIds = new Set([id])
 └── 캔버스 빈공간 클릭?
      ├── Ctrl 안누름 -> selectedIds.clear()
      └── isDraggingSelection = true, SelectionBox 시작점 기록

[MouseMove Event]
 └── isDraggingSelection === true?
      ├── SelectionBox 현재 좌표 업데이트
      └── 모든 images 대상 isIntersecting 검사 후 selectedIds 갱신

[MouseUp Event]
 └── isDraggingSelection = false, SelectionBox = null
```

---

### 4.3. 선택 객체 정렬 연산 (Alignment Algorithms)

선택된 이미지들의 집합 $S = \{img_1, img_2, \dots, img_n\}$ ($n \ge 2$) 에 대해:

#### 1. 바운딩 박스 최소/최대 좌표 계산
- $X_{min} = \min_{img \in S} (img.x)$
- $X_{max} = \max_{img \in S} (img.x + img.width)$
- $Y_{min} = \min_{img \in S} (img.y)$
- $Y_{max} = \max_{img \in S} (img.y + img.height)$

#### 2. 정렬 공식 적용
| 정렬 종류 | 변환 공식 (각 선택 객체 $img$ 에 적용) |
| :--- | :--- |
| **좌측 정렬 (Left)** | $img.x = X_{min}$ |
| **우측 정렬 (Right)** | $img.x = X_{max} - img.width$ |
| **상단 정렬 (Top)** | $img.y = Y_{min}$ |
| **하단 정렬 (Bottom)** | $img.y = Y_{max} - img.height$ |
| **수평 중앙 정렬 (Center H)** | $img.x = rac{X_{min} + X_{max}}{2} - rac{img.width}{2}$ |
| **수직 중앙 정렬 (Center V)** | $img.y = rac{Y_{min} + Y_{max}}{2} - rac{img.height}{2}$ |

---

## 5. 레퍼런스 구현 코드 (Reference Implementation)

```javascript
class CanvasSelectionManager {
  constructor(canvasElement, imagesData) {
    this.canvas = canvasElement;
    this.images = imagesData; // [{id, x, y, width, height}, ...]
    this.selectedIds = new Set();
    
    this.isDragging = false;
    this.selectionBox = null;

    this.bindEvents();
  }

  bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
  }

  getPointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  findImageAtPos(pos) {
    // 역순 검색 (z-index 상단 객체 우선)
    for (let i = this.images.length - 1; i >= 0; i--) {
      const img = this.images[i];
      if (
        pos.x >= img.x && pos.x <= img.x + img.width &&
        pos.y >= img.y && pos.y <= img.y + img.height
      ) {
        return img;
      }
    }
    return null;
  }

  onMouseDown(e) {
    const pos = this.getPointerPos(e);
    const clickedImg = this.findImageAtPos(pos);
    const isCtrlPressed = e.ctrlKey || e.metaKey;

    if (clickedImg) {
      if (isCtrlPressed) {
        // Ctrl + 클릭 토글
        if (this.selectedIds.has(clickedImg.id)) {
          this.selectedIds.delete(clickedImg.id);
        } else {
          this.selectedIds.add(clickedImg.id);
        }
      } else {
        // 단일 선택 (기존에 선택 안 된 경우만 재설정)
        if (!this.selectedIds.has(clickedImg.id)) {
          this.selectedIds = new Set([clickedImg.id]);
        }
      }
    } else {
      // 빈 공간 클릭: 드래그 영역 선택 시작
      if (!isCtrlPressed) {
        this.selectedIds.clear();
      }
      this.isDragging = true;
      this.selectionBox = { startX: pos.x, startY: pos.y, currentX: pos.x, currentY: pos.y };
    }

    this.render();
  }

  onMouseMove(e) {
    if (!this.isDragging || !this.selectionBox) return;

    const pos = this.getPointerPos(e);
    this.selectionBox.currentX = pos.x;
    this.selectionBox.currentY = pos.y;

    // 실시간 교차 검사 및 선택 업데이트
    this.images.forEach(img => {
      if (isIntersecting(this.selectionBox, img)) {
        this.selectedIds.add(img.id);
      }
    });

    this.render();
  }

  onMouseUp() {
    this.isDragging = false;
    this.selectionBox = null;
    this.render();
  }

  // 이미지 정렬 메소드
  alignSelectedImages(type) {
    const selectedObjects = this.images.filter(img => this.selectedIds.has(img.id));
    if (selectedObjects.length < 2) return; // 정렬에는 최소 2개 이상 필요

    const xMin = Math.min(...selectedObjects.map(img => img.x));
    const xMax = Math.max(...selectedObjects.map(img => img.x + img.width));
    const yMin = Math.min(...selectedObjects.map(img => img.y));
    const yMax = Math.max(...selectedObjects.map(img => img.y + img.height));

    selectedObjects.forEach(img => {
      switch (type) {
        case 'LEFT':
          img.x = xMin;
          break;
        case 'RIGHT':
          img.x = xMax - img.width;
          break;
        case 'TOP':
          img.y = yMin;
          break;
        case 'BOTTOM':
          img.y = yMax - img.height;
          break;
        case 'CENTER_H':
          img.x = (xMin + xMax) / 2 - img.width / 2;
          break;
        case 'CENTER_V':
          img.y = (yMin + yMax) / 2 - img.height / 2;
          break;
      }
    });

    this.render();
  }

  render() {
    // 캔버스 재그리기 및 드래그 박스/선택 하이라이트 표시
  }
}
```

---

## 6. 검증 및 테스트 시나리오 (Test Cases)

| 번호 | 테스트 케이스 | 조작 | 기대 결과 |
| :--- | :--- | :--- | :--- |
| **TC-1** | 드래그 부분 교차 선택 | 마우스로 이미지 엣지 부분만 1px 교차하도록 드래그 | 해당 이미지가 즉시 선택 항목으로 전환됨 |
| **TC-2** | Ctrl + 클릭 토글 (선택) | `Ctrl` 누른 상태로 미선택 이미지 클릭 | 기존 선택 유지되며 클릭한 이미지가 추가 선택됨 |
| **TC-3** | Ctrl + 클릭 토글 (해제) | `Ctrl` 누른 상태로 이미 선택된 이미지 클릭 | 해당 이미지만 선택 해제됨 |
| **TC-4** | 좌측 정렬 (Align Left) | 3개 객체 선택 후 좌측 정렬 버튼 클릭 | 선택된 3개 객체 모두 가장 왼쪽 x 좌표 위치로 일괄 이동 |
| **TC-5** | 수평 중앙 정렬 | 다양한 크기의 객체 3개 선택 후 수평 중앙 정렬 실행 | 전체 선택 바운딩 박스의 수평 중심축 기준으로 중앙 정렬됨 |
| **TC-6** | 빈 영역 클릭 | `Ctrl` 없이 캔버스 배경 클릭 | 모든 선택 상태가 해제됨 |

---
**문서 관리 번호**: TECH-2026-0903  
**작성일**: 2026년 09월 03일
