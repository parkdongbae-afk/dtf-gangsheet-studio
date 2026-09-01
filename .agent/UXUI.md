# UX/UI Refactoring Plan — DTF.agent

본 문서는 S0~S8을 통해 검증 완료된 비즈니스 로직(Zustand 상태, Konva 캔버스 연동, Python 사이드카 IPC 통신)을 100% 보존하면서 시각적 완성도(UI/UX)를 최고 수준으로 끌어올리기 위한 단계를 정의합니다.

---

## 1. 개편 철칙 (AI Agent Strict Rules)

1. **로직 절대 보존 (Zero Logic Mutation)**
   - `useState`, `useStore(Zustand)`, Event Handler, IPC Invoke, Konva 좌표 수학 연산 등 기존 동작 로직은 **수정/삭제/재작성 금지**.
   - 오직 JSX 구조 개편, Tailwind CSS 클래스 교체, `lucide-react` 아이콘 배치만 수행한다.
2. **단위별 분할 리팩토링 (Component-by-Component)**
   - 한 세션에서 전체 화면을 바꾸지 않고, 지정된 1개 컴포넌트 단위로만 수정 및 검증을 거친다.
3. **단계별 회귀 테스트 (Regression Check)**
   - 각 Phase 완료 시 반드시 `npm run test` (Vitest) 및 `uv run pytest`를 수행하여 기존 단위 테스트 통과 여부를 확인한다.

---

## 2. 디자인 시스템 스펙 (Dark Industrial Theme)

- **디자인 컨셉**: Figma / Photoshop / Linear 스타일의 High-Density 그래픽 툴 Dark Theme
- **컬러 팔레트**:
  - Main Background: `bg-zinc-950`
  - Panel / Card Background: `bg-zinc-900`
  - Hover / Active Background: `hover:bg-zinc-800` / `active:bg-zinc-700`
  - Border / Divider: `border-zinc-800`
  - Text: Main `text-zinc-200`, Sub `text-zinc-400`, Muted `text-zinc-500`
  - Accent / Focus Ring: `indigo-500` (`ring-1 ring-indigo-500` / `bg-indigo-600`)
- **타이포그래피 & 밀도**: 고밀도 컴팩트 레이아웃 (`text-xs` ~ `text-sm`, 기본 패딩 `p-1.5` ~ `p-2.5`)
- **아이콘 시스템**: `lucide-react` (Stroke Width: `1.5px` 고정)

---

## 3. 단계별 개편 실행 로드맵

### Phase 0: 디자인 인프라 구축
- **작업 내용**:
  - `Tailwind CSS`, `lucide-react`, `clsx`, `tailwind-merge` 패키지 상태 점검 및 설치
  - `src/index.css` (또는 `globals.css`)에 Dark Theme 기본 배경 및 스크롤바 스타일 정의
- **Target File**: `package.json`, `src/index.css`

### Phase 1: 앱 껍데기 및 메인 레이아웃 (App Shell)
- **작업 내용**:
  - **상단 툴바 (Top Bar)**: 문서 정보 표시, 메인 메뉴, 내보내기 버튼의 시각적 강조
  - **좌측 도구 상자 (Left Toolbar)**: 이미지 추가, 선택, 이동, 핸드 툴 아이콘 버튼화
  - **우측 속성 패널 (Properties Panel)**: 위치(X/Y), 크기(W/H), 회전, 레이어 순서 컨트롤을 컴팩트 아코디언 카드 형태로 전환
- **Target Files**: `src/components/layout/*`, `src/components/PropertiesPanel.tsx`

### Phase 2: 모달 & 다이얼로그 (Modals & Dialogs)
- **작업 내용**:
  - **신규 문서 다이얼로그**: 1m / 2m 프리셋 선택 카드 및 Custom 입력 UI 모던화
  - **그리드 복제 다이얼로그**: 행(Row)×열(Col), 간격(Gap) 입력 인터랙션 및 리셋 버튼 다듬기
  - **내보내기 진행 프로그레스 모달**: Processing 상태를 나타내는 인디케이터 및 다크 모드 팝업 적용
- **Target Files**: `src/components/dialogs/*`

### Phase 3: 캔버스 오버레이 & 마이크로 인터랙션
- **작업 내용**:
  - **HUD 배율 컨트롤**: 하단 줌(Zoom) %, 100% 리셋, 핏 화면 버튼 오버레이 디자인
  - **Konva Transformer 커스텀**: 선택 바운딩 박스 컬러(`indigo-500`), 회전 핸들 스냅 스타일링
  - **툴팁 및 호버 애니메이션**: 모든 버튼에 0.15초 Fade-in Tooltip 및 Micro Hover (`transition-all`) 적용
- **Target Files**: `src/components/canvas/*`

---

## 4. AI 세션용 프롬프트 템플릿

특정 컴포넌트 개편 시 아래 프롬프트를 복사하여 AI 에이전트에 입력한다.

```text
[요구사항]
@src/components/{파일명} 컴포넌트의 시각적 UI/UX를 Dark Industrial 스타일로 개편해줘.

[절대 지침 - Logic Protection]
1. 기존의 State, Zustand Store 연동, Event Handler, IPC 통신, 수학 연산 로직은 **절대 수정하거나 삭제하지 말 것**.
2. 오직 JSX 태그 구조, Tailwind CSS 클래스, `lucide-react` 아이콘 배치만 변경할 것.
3. 기존 Props 타입 정의와 Export 이름은 변경하지 말 것.

[디자인 가이드라인]
- Figma/Photoshop 스타일 Dark Industrial Theme
- 배경 `bg-zinc-950` / 패널 `bg-zinc-900` / 테두리 `border-zinc-800` / 텍스트 `text-zinc-200`
- 고밀도 레이아웃 (`text-xs`, 타이트한 패딩 `p-1.5`~`p-2`)
- Input 옆에는 단위 라벨(cm, px, deg 등)을 `text-zinc-500`으로 배치
- 모든 Clickable 요소에 `hover:bg-zinc-800 transition-colors` 적용