# -*- coding: utf-8 -*-
"""사용자 메뉴얼 PDF에 v0.2.x 업데이트 안내 페이지를 추가한다 (재현 스크립트).

사용: cd export-sidecar && uv run --with pypdf --with reportlab python ../scripts/append_manual_v021.py
"""
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parent.parent
MANUAL = ROOT / "resources" / "DTF_사용자_메뉴얼.pdf"
FONT = Path("C:/Windows/Fonts/malgun.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/malgunbd.ttf")

pdfmetrics.registerFont(TTFont("Malgun", str(FONT)))
pdfmetrics.registerFont(TTFont("MalgunBold", str(FONT_BOLD)))
registerFontFamily(
    "Malgun", normal="Malgun", bold="MalgunBold", italic="Malgun", boldItalic="MalgunBold"
)

H2 = ParagraphStyle("H2", fontName="Malgun", fontSize=15, leading=22, spaceAfter=8)
H3 = ParagraphStyle("H3", fontName="Malgun", fontSize=12, leading=18, spaceBefore=9, spaceAfter=3)
BODY = ParagraphStyle("BODY", fontName="Malgun", fontSize=10.5, leading=16.5)
ITEM = ParagraphStyle("ITEM", fontName="Malgun", fontSize=10.5, leading=16.5, leftIndent=8)

flow = [
    Paragraph("<b>v0.2.1 업데이트 안내 — 새 기능 한눈에 보기</b>", H2),
    Paragraph(
        "이 페이지는 v0.1.0 매뉴얼 발행 이후 추가된 기능을 정리합니다. 각 기능의 상세 조작은 "
        "앱 하단의 단축키 힌트줄과 속성 패널에서도 확인할 수 있습니다.",
        BODY,
    ),
    Paragraph("<b>문서 규격 · 파일 관리</b>", H3),
    Paragraph(
        "• <b>새 문서 규격 프리셋</b>: 시작 화면에서 [롤(강시트)] / [A4] / [A3] 탭으로 규격을 "
        "선택합니다. A4·A3 규격을 요구하는 인쇄 업체에 그대로 대응합니다.", ITEM,
    ),
    Paragraph(
        "• <b>프로젝트 저장·불러오기</b>: 작업 내용을 .dtf 파일로 저장(Ctrl+S)하고 다시 열 수 "
        "있습니다. 툴바 [새 파일] 버튼으로 언제든 새 문서로 시작합니다.", ITEM,
    ),
    Paragraph(
        "• <b>문서 이름 표시</b>: 캔버스 좌측 상단에 현재 작업 중인 .dtf 파일 이름이 표시됩니다.",
        ITEM,
    ),
    Paragraph("<b>편집 — 다중 선택 · 그룹 · 정렬</b>", H3),
    Paragraph(
        "• <b>다중 선택</b>: 빈 곳 드래그(영역 선택) 또는 Ctrl+클릭으로 여러 이미지를 동시에 선택해 "
        "함께 이동·복제·정렬합니다.", ITEM,
    ),
    Paragraph(
        "• <b>그룹</b>: 선택 2개 이상에서 Ctrl+G로 묶고 Ctrl+Shift+G로 해제합니다. 그룹은 하나의 "
        "단위처럼 선택·이동되며, 우클릭 메뉴의 정렬·<b>수평/수직 간격 균등 분배</b>에서도 그룹 내부 "
        "배치가 유지됩니다.", ITEM,
    ),
    Paragraph(
        "• <b>복제</b>: Ctrl+드래그로 원본을 그 자리에 두고 사본을 끌어내거나, Ctrl+D로 화면 "
        "오프셋 복제합니다. Ctrl+C/X/V 클립보드도 지원합니다.", ITEM,
    ),
    Paragraph(
        "• <b>미세 이동</b>: 방향키로 1~50mm 단위 이동(Shift=1mm), 하단 힌트줄 스텝퍼로 거리 조절.",
        ITEM,
    ),
    Paragraph(
        "• <b>잠금</b>: Ctrl+L로 선택 항목을 잠그면 이동·삭제·정렬이 차단되어 확정된 블록을 보호합니다.",
        ITEM,
    ),
    Paragraph(
        "• <b>우클릭 메뉴</b>: 복제·삭제·그룹·정렬 6종·간격 분배·문서 기준 정렬·레이어 순서를 한 곳에서.",
        ITEM,
    ),
    Paragraph("<b>이미지 가져오기 — 실제 크기(물리 치수) 보존</b>", H3),
    Paragraph(
        "PNG/JPEG의 DPI 메타데이터를 읽어 <b>원본의 실제 가로·세로 cm</b>를 그대로 유지하며 배치합니다. "
        "예: 500dpi로 저장된 5cm 도안도 350dpi 캔버스에 5cm 크기로 들어옵니다(종전에는 7cm로 커졌습니다). "
        "메타데이터가 없는 이미지는 기존처럼 픽셀 크기 그대로 배치됩니다.",
        BODY,
    ),
    Paragraph("<b>보기 · 성능</b>", H3),
    Paragraph(
        "• <b>휠 클릭 팬</b>: 마우스 중앙 버튼 드래그로 화면 이동 — 이미지 위에서 시작해도 이미지가 "
        "움직이지 않습니다.", ITEM,
    ),
    Paragraph(
        "• <b>스냅 간격 라벨 대형화</b>: 이미지 사이 간격(mm) 숫자를 3배 크기로 표시해 가독성 개선.",
        ITEM,
    ),
    Paragraph(
        "• <b>배경 제거 속도</b>: 기본 모델(isnet) 번들·시작 예열·항목별 즉시 반영으로 대기 시간 단축.",
        ITEM,
    ),
    Paragraph("<b>내보내기</b>", H3),
    Paragraph(
        "• <b>단일 인쇄 레이어로 병합</b>이 기본 선택입니다(필요 시 해제 가능).", ITEM,
    ),
    Paragraph("• 내보내기 완료 후에는 [닫기]만 표시됩니다. 재내보내기는 창을 다시 열어 진행합니다.", ITEM),
    Paragraph(
        "• 렌더 실패 시 <b>'메모리가 부족합니다.'</b> 안내가 표시됩니다 — 항목 수를 나누어 내보내거나 "
        "다른 프로그램을 종료한 뒤 다시 시도하세요.", ITEM,
    ),
    PageBreak(),
    Paragraph("<b>기타 추가 기능</b>", H2),
    Paragraph(
        "• <b>오픈소스 라이선스</b>: 속성 패널 하단 [오픈소스 라이선스] 버튼으로 이 앱이 사용하는 "
        "오픈소스 라이브러리의 라이선스 고지를 확인합니다.", ITEM,
    ),
    Paragraph(
        "• <b>Adobe Express 배경 제거 가이드</b>: [배경 제거 사이트] 창 맨 아래에서 전용 PDF "
        "가이드를 바로 열 수 있습니다.", ITEM,
    ),
    Paragraph(
        "• <b>그리드 표시 설정·체커보드 배경·자동 배치(MaxRects)</b>: 툴바에서 각 버튼으로 설정합니다.",
        ITEM,
    ),
]


def main() -> None:
    section = ROOT / "scripts" / "_manual_v021.pdf"
    doc = SimpleDocTemplate(
        str(section), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm, title="v0.2.1 업데이트 안내",
    )
    doc.build(flow)

    reader = PdfReader(str(MANUAL))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    for page in PdfReader(str(section)).pages:
        writer.add_page(page)
    with open(MANUAL, "wb") as fh:
        writer.write(fh)
    section.unlink()
    print(f"appended: {MANUAL} -> {len(writer.pages)} pages")


if __name__ == "__main__":
    main()
