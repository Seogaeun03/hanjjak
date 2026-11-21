"""웹폰트가 실제로 그리는 코드포인트만 골라 @font-face 의 unicode-range 를 만든다.

긱블 말랑이체는 한글 음절 11,172자를 전부 cmap 에 등록해 두고 외곽선은 상용 2,350자
계열에만 넣어 두었다. 나머지는 폭만 있고 외곽선이 없는 빈 글리프다. cmap 에 항목이
있으면 브라우저는 그 폰트가 해당 글자를 지원한다고 보고 대체 글꼴로 넘어가지 않으므로,
'땨' '뚀' '뜌' '쬬' 같은 글자가 투명한 공백으로 찍힌다.

unicode-range 로 외곽선이 있는 코드포인트만 이 폰트에 맡기면 나머지는 스택 다음
글꼴(Malgun Gothic)로 자동으로 넘어간다. 폰트 파일 자체는 건드리지 않으므로
수정·재배포를 금지한 사용 가이드에도 걸리지 않는다.

사용법:
    pip install fonttools brotli
    python tools/font-unicode-range.py
"""

from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "apps/web/src/shared/assets/fonts/GeekbleMalang2WOFF2.woff2"
OUTPUT = ROOT / "apps/web/src/shared/assets/fonts/geekble-malang2.css"


def drawn_code_points(font: TTFont) -> list[int]:
    """외곽선이 있는 코드포인트. 공백은 외곽선이 없는 게 정상이라 따로 남긴다."""
    glyphs = font.getGlyphSet()
    result = []
    for code_point, glyph_name in sorted(font.getBestCmap().items()):
        if code_point < 0x20:
            continue
        pen = BoundsPen(glyphs)
        try:
            glyphs[glyph_name].draw(pen)
        except Exception:
            continue
        if pen.bounds is not None or code_point == 0x20:
            result.append(code_point)
    return result


def to_ranges(code_points: list[int]) -> list[tuple[int, int]]:
    ranges: list[list[int]] = []
    for code_point in code_points:
        if ranges and code_point == ranges[-1][1] + 1:
            ranges[-1][1] = code_point
        else:
            ranges.append([code_point, code_point])
    return [(start, end) for start, end in ranges]


def main() -> None:
    font = TTFont(FONT)
    code_points = drawn_code_points(font)
    ranges = to_ranges(code_points)
    formatted = ", ".join(
        f"U+{start:04X}" if start == end else f"U+{start:04X}-{end:04X}"
        for start, end in ranges
    )
    OUTPUT.write_text(
        "/* tools/font-unicode-range.py 가 생성한다. 직접 고치지 않는다.\n"
        f"   외곽선이 있는 코드포인트 {len(code_points)}개, 구간 {len(ranges)}개.\n"
        "   범위 밖 글자는 Malgun Gothic 으로 넘어간다. 이유는 생성기 주석에 있다. */\n"
        '@font-face {\n'
        '  font-family: "Geekble Malang2";\n'
        '  src: url("./GeekbleMalang2WOFF2.woff2") format("woff2");\n'
        "  font-display: swap;\n"
        f"  unicode-range: {formatted};\n"
        "}\n",
        encoding="utf-8",
    )
    print(f"{OUTPUT.relative_to(ROOT)}: 코드포인트 {len(code_points)}개 / 구간 {len(ranges)}개")


if __name__ == "__main__":
    main()
