"""Builds ui/abyss/fonts/AbyssPixelArrows.woff: four arrows (U+2190-2193) on Jersey 10's 75-unit pixel grid.

Jersey 10 has no arrow glyphs, so the page would otherwise fall back to a smooth system font for the
legend title, the ending buttons and the list-key hint. The bitmaps below are drawn for this project.
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

PIXEL, UPM = 75, 1400
RIGHT = [".....X...", "......X..", ".......X.", "XXXXXXXXX", ".......X.", "......X..", ".....X..."]
UP = ["...X...", "..XXX..", ".X.X.X.", "X..X..X", "...X...", "...X...", "...X...", "...X...", "...X..."]
OUT = Path(__file__).resolve().parents[1] / "ui/abyss/fonts/AbyssPixelArrows.woff"


def glyph(rows, base):
    pen = TTGlyphPen(None)
    for y, row in enumerate(rows):
        top = base + (len(rows) - y) * PIXEL
        x = 0
        while x < len(row):
            if row[x] != "X":
                x += 1
                continue
            start = x
            while x < len(row) and row[x] == "X":
                x += 1
            left, right = PIXEL + start * PIXEL, PIXEL + x * PIXEL
            pen.moveTo((left, top - PIXEL))
            pen.lineTo((left, top))
            pen.lineTo((right, top))
            pen.lineTo((right, top - PIXEL))
            pen.closePath()
    return pen.glyph()


glyphs = {
    ".notdef": glyph([], 0),
    "rightarrow": glyph(RIGHT, 112),
    "leftarrow": glyph([row[::-1] for row in RIGHT], 112),
    "uparrow": glyph(UP, 37),
    "downarrow": glyph(UP[::-1], 37),
}
builder = FontBuilder(UPM, isTTF=True)
builder.setupGlyphOrder(list(glyphs))
builder.setupCharacterMap({0x2190: "leftarrow", 0x2191: "uparrow", 0x2192: "rightarrow", 0x2193: "downarrow"})
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics({".notdef": (825, 0), "rightarrow": (825, PIXEL), "leftarrow": (825, PIXEL), "uparrow": (750, PIXEL), "downarrow": (750, PIXEL)})
builder.setupHorizontalHeader(ascent=1125, descent=-375)
builder.setupNameTable({"familyName": "Abyss Pixel Arrows", "styleName": "Regular"})
builder.setupOS2(sTypoAscender=1125, sTypoDescender=-375, usWinAscent=1125, usWinDescent=375)
builder.setupPost()
builder.font.flavor = "woff"
builder.save(OUT)
print(OUT)
