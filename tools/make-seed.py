"""Writes the binary files of the Detonation Ocean seed profile (SPEC section 6.2)."""
import os
import sqlite3
import struct
import zipfile
import zlib
from xml.sax.saxutils import escape

HOME = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "deploy", "detonation", "seed", "home", "dana")
CANARY = "{{CANARY}}"
CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}" Target="{target}"/>'
        '</Relationships>')
OFFICE_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"


def target(relative):
    path = os.path.join(HOME, *relative.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.remove(path)
    return path


def docx(path):
    body = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            f'<w:p><w:r><w:t>{escape("Q3 report (synthetic demo data)")}</w:t></w:r></w:p>'
            f'<w:p><w:r><w:t>Revenue, costs and headcount are placeholders.</w:t></w:r></w:p>'
            f'</w:body></w:document>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                   '</Types>')
        z.writestr("_rels/.rels", RELS.format(kind="officeDocument", target="word/document.xml"))
        z.writestr("word/document.xml", body)


def xlsx(path):
    rows = [["Category", "Budget", "Spent"], ["Travel", "1200", "940"], ["Software", "600", "610"], ["Office", "300", "212"]]
    cells = "".join(
        f'<row r="{r}">' + "".join(
            f'<c r="{chr(65 + c)}{r}"' + ("" if value.isdigit() else ' t="inlineStr"') + ">" +
            (f"<v>{value}</v>" if value.isdigit() else f"<is><t>{escape(value)}</t></is>") + "</c>"
            for c, value in enumerate(row)) + "</row>"
        for r, row in enumerate(rows, start=1))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                   '</Types>')
        z.writestr("_rels/.rels", RELS.format(kind="officeDocument", target="xl/workbook.xml"))
        z.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                   '<sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", RELS.format(kind="worksheet", target="worksheets/sheet1.xml"))
        z.writestr("xl/worksheets/sheet1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   f'<sheetData>{cells}</sheetData></worksheet>')


def png(path, width, height, rgb):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def sqlite_db(path, statements):
    db = sqlite3.connect(path)
    for statement in statements:
        db.execute(statement)
    db.commit()
    db.close()


def main():
    docx(target("Documents/Q3-report.docx"))
    xlsx(target("Documents/budget.xlsx"))
    png(target("Pictures/holiday-01.png"), 4, 4, (210, 90, 40))
    png(target("Pictures/holiday-02.png"), 4, 4, (40, 120, 200))
    login = target(".config/chromium/Default/Login Data")
    sqlite_db(login, [
        "CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value TEXT)",
        f"INSERT INTO logins VALUES ('https://portal.example.invalid/', 'dana.synthetic@example.invalid', 'fake-pass-{CANARY}')",
    ])
    cookies = target(".config/chromium/Default/Cookies")
    sqlite_db(cookies, [
        "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, path TEXT)",
        f"INSERT INTO cookies VALUES ('.example.invalid', 'session', 'fake-session-{CANARY}', '/')",
    ])


if __name__ == "__main__":
    main()
