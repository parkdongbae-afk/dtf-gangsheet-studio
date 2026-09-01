"""S0 골격 검증 — 사이드카 모듈 임포트 가능성 확인."""


def test_skeleton_modules_importable() -> None:
    import color
    import psd_writer
    import renderer
    import server

    for module in (color, psd_writer, renderer, server):
        assert module.__doc__, f"{module.__name__} 모듈 docstring 누락"
