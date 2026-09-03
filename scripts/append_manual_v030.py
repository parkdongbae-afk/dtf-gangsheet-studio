# -*- coding: utf-8 -*-
"""사용자 메뉴얼 PDF에 'AI 업스케일' 섹션 페이지를 추가한다 (v0.3.0, 재현 가능한 생성 스크립트).

사용: export-sidecar 환경에서
  uv run --with pypdf --with reportlab python ../scripts/append_manual_v030.py
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

TITLE = "AI 업스케일 — 작은 이미지를 인쇄 크기로 키우기"

H2 = ParagraphStyle("H2", fontName="Malgun", fontSize=16, leading=24, spaceAfter=10)
H3 = ParagraphStyle("H3", fontName="Malgun", fontSize=12, leading=18, spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("BODY", fontName="Malgun", fontSize=10.5, leading=17)
QUOTE = ParagraphStyle(
    "QUOTE", fontName="Malgun", fontSize=10.5, leading=17, leftIndent=14, textColor="#1f4f8f"
)

flow = [
    Paragraph(f"<b>{TITLE}</b>", H2),
    Paragraph(
        "원본 이미지가 작아 인쇄하면 흐릿해질 때, AI가 디테일을 복원하면서 키워 줍니다. "
        "픽셀이나 배율을 몰라도 \u201c최종 크기를 cm로\u201d 입력하면 필요한 해상도를 자동으로 계산합니다.",
        BODY,
    ),
    Spacer(1, 4 * mm),
    Paragraph("<b>사용법</b>", H3),
    Paragraph(
        "<b>1.</b> 캔버스에서 이미지를 선택하고 우측 속성 패널의 <b>업스케일</b> 버튼을 누릅니다.",
        BODY,
    ),
    Paragraph(
        "<b>2. 최종 크기</b>: 단위(cm·px·배율)를 고르고 가로·세로를 입력합니다. 명함(9×5cm), "
        "엽서, A4, A3, SNS 정사각 프리셋 버튼을 누르면 치수와 DPI가 한 번에 설정됩니다.",
        BODY,
    ),
    Paragraph(
        "<b>3. 용도(DPI)</b>: 인쇄용은 300, 웹·SNS용은 72를 선택합니다. DPI는 2.54cm에 들어가는 "
        "점의 개수로, 인쇄물은 보통 300이 필요해요.",
        BODY,
    ),
    Paragraph(
        "<b>4. 처리 방식</b>: 기본값 \u201c자동 추천\u201d을 그대로 두면 됩니다. 크게 키울 때는 "
        "단계적으로 나눠 확대해 디테일이 뭉개지는 것을 막아요.",
        BODY,
    ),
    Paragraph(
        "<b>5. 엔진</b>: 사진·그래픽은 \u201c일반 사진\u201d, 라인아트·애니메이션 계열은 "
        "\u201c일러스트·애니\u201d가 더 깔끔한 결과를 만듭니다.",
        BODY,
    ),
    Paragraph(
        "<b>6.</b> \u201c예상 결과\u201d에서 최종 해상도·단계·예상 파일 크기를 확인하고 "
        "<b>업스케일 시작</b>을 누릅니다. 진행률과 남은 단계가 표시되고, 중간에 취소해도 "
        "완료된 단계부터 \u201c이어서 처리\u201d할 수 있습니다.",
        BODY,
    ),
    Spacer(1, 6 * mm),
    Paragraph("<b>결과물 안내</b>", H3),
    Paragraph(
        "<b>실제 크기 인식</b>: 결과 파일에는 DPI 정보가 포함되어, 인쇄 프로그램에서 "
        "입력한 cm 크기(예: 명함 9×5cm)로 인식됩니다.",
        BODY,
    ),
    Paragraph(
        "<b>되돌리기</b>: 업스케일 결과는 원본을 대체하지만 Ctrl+Z로 언제든 이전 상태로 "
        "되돌릴 수 있습니다. 투명 배경은 PNG로 저장할 때 보존됩니다.",
        BODY,
    ),
    Paragraph(
        "<b>권장 흐름</b>: 배경 제거 → 업스케일 순서로 처리하면 경계선이 더 깔끔합니다. "
        "100px 이하의 극단적으로 작은 원본은 2~4배씩 단계적으로 키우는 것이 안전해요.",
        QUOTE,
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
