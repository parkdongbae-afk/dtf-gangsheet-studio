# -*- coding: utf-8 -*-
"""사용자 메뉴얼 PDF에 '나노 바나나 업스케일' 섹션 페이지를 추가한다 (재현 가능한 생성 스크립트).

사용: export-sidecar 환경에서
  uv run --with pypdf --with reportlab python ../scripts/append_manual_section.py
"""
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parent.parent
MANUAL = ROOT / "resources" / "DTF_사용자_메뉴얼.pdf"
FONT = Path("C:/Windows/Fonts/malgun.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/malgunbd.ttf")

pdfmetrics.registerFont(TTFont("Malgun", str(FONT)))
pdfmetrics.registerFont(TTFont("MalgunBold", str(FONT_BOLD)))
registerFontFamily(
    "Malgun", normal="Malgun", bold="MalgunBold", italic="Malgun", boldItalic="MalgunBold"
)

TITLE = "저해상도 이미지 나노 바나나로 고해상도 만들기"

H2 = ParagraphStyle("H2", fontName="Malgun", fontSize=16, leading=24, spaceAfter=10)
H3 = ParagraphStyle("H3", fontName="Malgun", fontSize=12, leading=18, spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("BODY", fontName="Malgun", fontSize=10.5, leading=17)
QUOTE = ParagraphStyle(
    "QUOTE", fontName="Malgun", fontSize=10.5, leading=17, leftIndent=14, textColor="#1f4f8f"
)

flow = [
    Paragraph(f"<b>{TITLE}</b>", H2),
    Paragraph("<b>대화형 AI (Gemini / 나노바나나) 프롬프트 활용법</b>", H3),
    Paragraph(
        "<b>이미지 첨부</b>: 대화창의 클립 모양 아이콘을 눌러 저해상도 이미지를 업로드합니다.",
        BODY,
    ),
    Paragraph("<b>명령어(프롬프트) 입력</b>:", BODY),
    Paragraph(
        "\u201c이 사진의 구도, 색감, 피사체 형태를 100% 동일하게 유지하면서, "
        "피부 질감과 머리카락 디테일이 살아있는 초고화질(4K) 상태로 업스케일해줘.\u201d",
        QUOTE,
    ),
    Paragraph(
        "\u201c외곽선의 픽셀 깨짐을 지우고 깔끔하고 선명한 고해상도 이미지로 만들어줘.\u201d",
        QUOTE,
    ),
    Paragraph(
        "<b>추가 정교화</b>: 생성된 결과를 보고 \u201c옷감의 결을 조금 더 선명하게 다듬어줘\u201d처럼 "
        "연속 대화로 디테일을 수정합니다.",
        BODY,
    ),
    Spacer(1, 6 * mm),
    Paragraph("<b>DTF 인쇄 및 디자인 작업 시 유의사항</b>", H3),
    Paragraph(
        "<b>PNG 포맷 다운로드</b>: 인쇄용 갱시트나 캔버스에 배치할 목적이라면, 화질 손실이 없고 "
        "알파 채널(투명 배경)을 보존할 수 있도록 PNG 파일로 저장하세요.",
        BODY,
    ),
    Paragraph(
        "<b>단계별 업스케일</b>: 원본 이미지가 너무 극단적으로 작으면(예: 100px 이하) AI가 형체를 "
        "잘못 해석할 수 있으므로, 2배~4배씩 단계적으로 올리는 것이 가장 깨끗한 결과를 만들어 냅니다.",
        BODY,
    ),
]


def main() -> None:
    section = ROOT / "scripts" / "_manual_section.pdf"
    doc = SimpleDocTemplate(
        str(section), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm, title=TITLE,
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
