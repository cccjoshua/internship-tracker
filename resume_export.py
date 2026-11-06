"""Resume export to .docx (Office Open XML) and .pdf, using only the Python standard library.

Both formats are drawn from the same resume model and the same layout numbers, and the fonts are
metric-compatible pairs (Times New Roman / Times, Arial / Helvetica), so the Word file and the PDF break
lines in the same places. fit() picks the largest font size, down to 10 pt (the Rice CCD guide's minimum
for body text), that keeps the document on one page.

A cover letter uses the same writers with {"kind": "letter", "header", "date", "recipient": [str], "re",
"salutation", "paragraphs": [str], "closing", "signature"} and the resume's header, so both match.

Resume model (also used by the page):
{ "font": "serif" | "sans", "size": 10.5,
  "header": {"name": str, "contact": str},
  "sections": [ {"kind": "summary", "title": str, "text": str}
              | {"kind": "skills", "title": str, "lines": [{"label": str, "value": str}]}
              | {"kind": "entries", "title": str, "entries": [{"title", "loc", "date", "subtitle", "subdate", "lines": [str], "bullets": [{"text"}], "hidden"}]}
              | {"kind": "list", "title": str, "items": [str]} ] }
Sections or entries with "hidden": true are left out.
Layout (US one-page standard): centered bold name and contact line; plain uppercase section headings over a rule;
each entry is "Organization (bold) ........ Location (italic)" then "Title or degree (italic) ........ Dates (italic)";
when an entry has no location, its date sits on the first line. Detail lines and skills are bullets.
Optional "bold": [str] lists the posting keywords to set in bold wherever they appear in bullets and the summary
(whole words, any case); "boldKeywords": false turns that off.
"""
import io
import re
import zipfile
from xml.sax.saxutils import escape as xesc

from fontmetrics import WIDTHS

PAGE_W, PAGE_H = 612.0, 792.0  # US Letter in points
FONTS = {"serif": ("Times-Roman", "Times-Bold", "Times-Italic", "Times New Roman"),
         "sans": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Arial")}
SUBS = {"‐": "-", "‑": "-", "−": "-", " ": " ", "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "×": "x", "≈": "~"}


def subs(s):
    s = str(s or "")
    for a, b in SUBS.items():
        s = s.replace(a, b)
    return s


def clean(s):
    return re.sub(r"\s+", " ", subs(s)).strip()


def enc(s):
    return subs(s).encode("cp1252", "replace")


def unsupported_chars(model):
    """Characters the PDF's standard fonts (Windows-1252) cannot show. The PDF export refuses rather than print '?'."""
    bad = []
    for b in blocks(model):
        for part in b[1:]:
            for ch in subs(part if isinstance(part, str) else ""):
                try:
                    ch.encode("cp1252")
                except UnicodeEncodeError:
                    if ch not in bad:
                        bad.append(ch)
    return bad


def width(s, font, size):
    w = WIDTHS[font]
    return sum(w[b] for b in enc(s)) * size / 1000.0


# ---------------------------------------------------------------- layout
class Spec:
    def __init__(self, model, size=None, tight=1.0):
        self.font = model.get("font") if model.get("font") in FONTS else "serif"
        self.reg, self.bold, self.ital, self.word = FONTS[self.font]
        self.letter = model.get("kind") == "letter"
        self.size = float(size or model.get("size") or (11 if self.letter else 10.5))
        s = self.size
        self.lead = s * 1.17
        self.name_size = round(s * 1.75, 1)
        self.head_size = s + 1.5
        self.margin_x = float(model.get("marginX") or (0.75 if self.letter else 0.6)) * 72
        self.margin_y = float(model.get("marginY") or (0.75 if self.letter else 0.5)) * 72
        self.gap_section = s * 0.62 * tight
        self.gap_rule = s * 0.22 * tight
        self.gap_entry = s * 0.5 * tight
        self.bullet_indent = 22.0
        self.bullet_x = 9.0  # the bullet glyph sits indented, the text hangs after it
        self.text_w = PAGE_W - 2 * self.margin_x


def bold_segments(text, terms):
    """Split text into [(segment, is_bold)], bolding every whole-word occurrence of the terms (longest first)."""
    terms = sorted({clean(t) for t in terms or [] if clean(t) and len(clean(t)) >= 2}, key=len, reverse=True)
    if not text or not terms:
        return [(text, False)]
    rx = re.compile(r"(?<![A-Za-z0-9])(?:" + "|".join(re.escape(t) for t in terms) + r")(?![A-Za-z0-9+#])", re.I)
    out, i = [], 0
    for m in rx.finditer(text):
        if m.start() > i:
            out.append((text[i:m.start()], False))
        out.append((m.group(0), True))
        i = m.end()
    if i < len(text):
        out.append((text[i:], False))
    return out or [(text, False)]


def blocks(model):
    """Flatten the model into drawable blocks (shared by both writers). Bullets and the summary carry a third item:
    their text split into (segment, is_bold) pieces for the keywords to show in bold."""
    out = []
    terms = model.get("bold") if model.get("boldKeywords", True) is not False and isinstance(model.get("bold"), list) else []
    terms = [str(t) for t in terms if isinstance(t, str)][:80]
    h = model.get("header") or {}
    if h.get("name"):
        out.append(("name", clean(h["name"])))
    if h.get("contact"):
        out.append(("contact", clean(h["contact"])))
    if model.get("kind") == "letter":
        out.append(("rule",))
        seq = [model.get("date")], model.get("recipient") or [], [model.get("re")], [model.get("salutation")]
        for group in seq:
            lines_ = [clean(x) for x in group if clean(x)]
            if lines_:
                out.append(("gap", 1.0))
                out += [("line", x) for x in lines_]
        for para in model.get("paragraphs") or []:
            if clean(para):
                out.append(("gap", 0.75))
                out.append(("text", clean(para)))
        if clean(model.get("closing")):
            out += [("gap", 1.0), ("line", clean(model["closing"]))]
        if clean(model.get("signature")):
            out += [("gap", 2.2), ("line", clean(model["signature"]))]
        return out
    for sec in model.get("sections") or []:
        if sec.get("hidden"):
            continue
        kind, body = sec.get("kind"), []
        if kind == "summary" and clean(sec.get("text")):
            body.append(("text", clean(sec["text"]), bold_segments(clean(sec["text"]), terms)))
        elif kind == "skills":
            body += [("skill", clean(l.get("label")), clean(l.get("value"))) for l in sec.get("lines") or [] if clean(l.get("value")) and not l.get("hidden")]
        elif kind == "list":
            body += [("text", clean(x)) for x in sec.get("items") or [] if clean(x)]
        elif kind == "entries":
            for e in sec.get("entries") or []:
                if e.get("hidden"):
                    continue
                loc, date, sub, subdate = clean(e.get("loc")), clean(e.get("date")), clean(e.get("subtitle")), clean(e.get("subdate"))
                if loc:  # Organization ... Location / Title ... Dates
                    dates = " – ".join(x for x in (date, subdate) if x) if date != subdate else date
                    body.append(("entry", clean(e.get("title")), loc))
                    if sub or dates:
                        body.append(("sub", sub, dates))
                else:
                    body.append(("entry", clean(e.get("title")), date))
                    if sub or subdate:
                        body.append(("sub", sub, subdate))
                body += [("bullet", clean(x)) for x in e.get("lines") or [] if clean(x)]
                body += [("bullet", clean(b.get("text")), bold_segments(clean(b.get("text")), terms))
                         for b in e.get("bullets") or [] if clean(b.get("text")) and not b.get("hidden")]
        if body:
            out.append(("heading", clean(sec.get("title") or "").upper()))
            out += body
    return out


def wrap(runs, maxw, size, first_offset=0.0):
    """runs: [(text, font)] -> lines of runs. Breaks at spaces only: pieces of one word in different fonts
    (a bold keyword followed by a comma) stay together on one line."""
    words = []  # each word: [(piece, font)], or [(" ", font)] for a space
    glue = False
    for text, font in runs:
        for wd in re.split(r"(\s+)", text):
            if not wd:
                continue
            if wd.isspace():
                words.append([(" ", font)])
                glue = False
            elif glue and words:
                words[-1].append((wd, font))
            else:
                words.append([(wd, font)])
                glue = True
    lines, cur, cw = [], [], first_offset
    for w in words:
        if w[0][0] == " ":
            if cur:
                cur.append(w[0])
                cw += width(" ", w[0][1], size)
            continue
        ww = sum(width(t, f, size) for t, f in w)
        if cw + ww > maxw and any(not t.isspace() for t, _ in cur):
            while cur and cur[-1][0].isspace():
                cur.pop()
            lines.append(cur)
            cur, cw = [], 0.0
        cur.extend(w)
        cw += ww
    while cur and cur[-1][0].isspace():
        cur.pop()
    if cur:
        lines.append(cur)
    return lines or [[]]


def layout(model, size=None, tight=1.0):
    """Position every line. Returns (pages, spec): pages = [[op, ...]], op = (kind, x, y, payload)."""
    sp = Spec(model, size, tight)
    pages, ops = [], []
    y = sp.margin_y
    bottom = PAGE_H - sp.margin_y
    first_heading = True

    def need(h):
        nonlocal y, ops
        if y + h > bottom and ops:
            pages.append(ops)
            ops, y = [], sp.margin_y

    def text_lines(runs, x, w, size, lead, center=False, right=None):
        nonlocal y
        for ln in wrap(runs, w, size):
            need(lead)
            y += lead
            lw = sum(width(t, f, size) for t, f in ln)
            ox = x + (w - lw) / 2 if center else x
            ops.append(("runs", ox, y - lead * 0.22, (ln, size)))
            if right:
                ops.append(("runs", sp.margin_x + sp.text_w - width(right[0], right[1], size), y - lead * 0.22, ([(right[0], right[1])], size)))
                right = None

    for b in blocks(model):
        k = b[0]
        if k == "rule":
            y += 4
            ops.append(("rule", sp.margin_x, y, sp.margin_x + sp.text_w))
            continue
        if k == "gap":
            y += sp.lead * b[1] * (tight if tight < 1 else 1)
            continue
        if k == "line":
            text_lines([(b[1], sp.reg)], sp.margin_x, sp.text_w, sp.size, sp.lead)
            continue
        if k == "name":
            text_lines([(b[1], sp.bold)], sp.margin_x, sp.text_w, sp.name_size, sp.name_size * 1.15, center=True)
        elif k == "contact":
            text_lines([(b[1], sp.reg)], sp.margin_x, sp.text_w, sp.size - 0.5, sp.lead, center=True)
        elif k == "heading":
            gap = sp.gap_section * (0.6 if first_heading else 1)
            first_heading = False
            need(gap + sp.lead * 2.2)  # keep a heading with its first line
            y += gap
            text_lines([(b[1], sp.reg)], sp.margin_x, sp.text_w, sp.head_size, sp.head_size * 1.15)
            y += 1.6
            ops.append(("rule", sp.margin_x, y, sp.margin_x + sp.text_w))
            y += sp.gap_rule
        elif k == "entry":
            need(sp.gap_entry + sp.lead * 2)
            y += sp.gap_entry
            dw = width(b[2], sp.ital, sp.size) + 12 if b[2] else 0
            text_lines([(b[1], sp.bold)], sp.margin_x, sp.text_w - dw, sp.size, sp.lead, right=(b[2], sp.ital) if b[2] else None)
        elif k == "sub":
            dw = width(b[2], sp.ital, sp.size) + 12 if b[2] else 0
            text_lines([(b[1], sp.ital)], sp.margin_x, sp.text_w - dw, sp.size, sp.lead, right=(b[2], sp.ital) if b[2] else None)
        elif k == "text":
            runs = [(t, sp.bold if bo else sp.reg) for t, bo in b[2]] if len(b) > 2 else [(b[1], sp.reg)]
            text_lines(runs, sp.margin_x, sp.text_w, sp.size, sp.lead)
        elif k in ("bullet", "skill"):
            first = True
            runs = ([(b[1] + ": ", sp.bold), (b[2], sp.reg)] if k == "skill" else
                    [(t, sp.bold if bo else sp.reg) for t, bo in b[2]] if len(b) > 2 else [(b[1], sp.reg)])
            for ln in wrap(runs, sp.text_w - sp.bullet_indent, sp.size):
                need(sp.lead)
                y += sp.lead
                if first:
                    ops.append(("runs", sp.margin_x + sp.bullet_x, y - sp.lead * 0.22, ([("•", sp.reg)], sp.size)))
                    first = False
                ops.append(("runs", sp.margin_x + sp.bullet_indent, y - sp.lead * 0.22, (ln, sp.size)))
    pages.append(ops)
    sp.used = y  # height used on the last page
    return pages, sp


def fit(model, min_size=10.0):
    """Largest size (in 0.25 pt steps, then tighter spacing) that fits one page. Returns (size, tight, pages, fill)."""
    base = float(model.get("size") or (11 if model.get("kind") == "letter" else 10.5))
    s = base
    while s >= min_size - 1e-9:
        for tight in (1.0, 0.8):
            pages, sp = layout(model, s, tight)
            if len(pages) == 1:
                return s, tight, 1, (sp.used - sp.margin_y) / (PAGE_H - 2 * sp.margin_y)
        s = round(s - 0.25, 2)
    pages, sp = layout(model, min_size, 0.8)
    return min_size, 0.8, len(pages), (sp.used - sp.margin_y) / (PAGE_H - 2 * sp.margin_y)


# ---------------------------------------------------------------- PDF
def _pdf_str(s):
    b = enc(s)
    return b"(" + b.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)") + b")"


def to_pdf(model, auto_fit=True):
    size, tight = (fit(model)[:2] if auto_fit else (None, 1.0))
    pages, sp = layout(model, size, tight)
    fonts = [sp.reg, sp.bold, sp.ital]
    fid = {f: f"F{i + 1}" for i, f in enumerate(fonts)}
    objs = []  # index 0 -> object 1

    def add(b):
        objs.append(b)
        return len(objs)

    font_objs = [add(f"<< /Type /Font /Subtype /Type1 /BaseFont /{f} /Encoding /WinAnsiEncoding >>".encode()) for f in fonts]
    pages_id = add(b"")  # placeholder
    page_ids = []
    res = "<< /Font << " + " ".join(f"/{fid[f]} {font_objs[i]} 0 R" for i, f in enumerate(fonts)) + " >> >>"
    for ops in pages:
        out = [b"0 0 0 rg 0 0 0 RG"]
        for op in ops:
            if op[0] == "runs":
                _, x, y, (runs, size_) = op
                cx = x
                for t, f in runs:
                    if not t:
                        continue
                    out.append(b"BT /" + fid[f].encode() + b" %.2f Tf %.2f %.2f Td " % (size_, cx, PAGE_H - y) + _pdf_str(t) + b" Tj ET")
                    cx += width(t, f, size_)
            elif op[0] == "rule":
                _, x1, y, x2 = op
                out.append(b"0.6 w %.2f %.2f m %.2f %.2f l S" % (x1, PAGE_H - y, x2, PAGE_H - y))
        stream = b"\n".join(out)
        cid = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page_ids.append(add(f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_W:.0f} {PAGE_H:.0f}] /Resources {res} /Contents {cid} 0 R >>".encode()))
    objs[pages_id - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{p} 0 R' for p in page_ids)}] /Count {len(page_ids)} >>".encode()
    name = clean((model.get("header") or {}).get("name") or "Resume")
    doc_title = " - Cover Letter" if model.get("kind") == "letter" else " - Resume"
    info = add(b"<< /Title " + _pdf_str(name + doc_title) + b" /Author " + _pdf_str(name) + b" /Producer (Internship Tracker) >>")
    cat = add(f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode())
    buf = io.BytesIO()
    buf.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offs = []
    for i, b in enumerate(objs):
        offs.append(buf.tell())
        buf.write(b"%d 0 obj\n" % (i + 1) + b + b"\nendobj\n")
    xref = buf.tell()
    buf.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for o in offs:
        buf.write(b"%010d 00000 n \n" % o)
    buf.write(b"trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, cat, info, xref))
    return buf.getvalue()


# ---------------------------------------------------------------- DOCX
def _tw(pt):
    return int(round(pt * 20))


def to_docx(model, auto_fit=True):
    size, tight = (fit(model)[:2] if auto_fit else (None, 1.0))
    sp = Spec(model, size, tight)
    W = xesc
    tab_pos = _tw(sp.text_w)

    def run(t, bold=False, ital=False, sz=None):
        props = (f'<w:rFonts w:ascii="{sp.word}" w:hAnsi="{sp.word}" w:cs="{sp.word}"/>' + ("<w:b/>" if bold else "") + ("<w:i/>" if ital else "")
                 + f'<w:sz w:val="{int(round((sz or sp.size) * 2))}"/>')
        return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{W(subs(t))}</w:t></w:r>'

    def para(runs_xml, before=0.0, line=None, jc=None, tabs=False, border=False, numbered=False, keep=False):
        ppr = f'<w:spacing w:before="{_tw(before)}" w:after="0" w:line="{_tw(line or sp.lead)}" w:lineRule="exact"/>'
        if numbered:
            ppr = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' + ppr + f'<w:ind w:left="{_tw(sp.bullet_indent)}" w:hanging="{_tw(sp.bullet_indent - sp.bullet_x)}"/>'
        if tabs:
            ppr = f'<w:tabs><w:tab w:val="right" w:pos="{tab_pos}"/></w:tabs>' + ppr
        if border:
            ppr = '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr>' + ppr
        if keep:
            ppr = "<w:keepNext/>" + ppr
        if jc:
            ppr += f'<w:jc w:val="{jc}"/>'
        return f"<w:p><w:pPr>{ppr}</w:pPr>{runs_xml}</w:p>"

    body, first_heading, gap = [], True, 0.0
    for b in blocks(model):
        k = b[0]
        if k == "gap":
            gap += sp.lead * b[1] * (tight if tight < 1 else 1)
            continue
        if k == "rule":
            body.append('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:before="0" w:after="0" w:line="80" w:lineRule="exact"/></w:pPr></w:p>')
            continue
        if k == "line":
            body.append(para(run(b[1]), before=gap)); gap = 0.0
            continue
        if k == "text" and sp.letter:
            body.append(para(run(b[1]), before=gap)); gap = 0.0
            continue
        if k == "name":
            body.append(para(run(b[1], bold=True, sz=sp.name_size), line=sp.name_size * 1.15, jc="center"))
        elif k == "contact":
            body.append(para(run(b[1], sz=sp.size - 0.5), jc="center"))
        elif k == "heading":
            gap = sp.gap_section * (0.6 if first_heading else 1)
            first_heading = False
            body.append(para(run(b[1], sz=sp.head_size), before=gap, line=sp.head_size * 1.15, border=True, keep=True))
        elif k == "entry":
            r = run(b[1], bold=True) + ('<w:r><w:tab/></w:r>' + run(b[2], ital=True) if b[2] else "")
            body.append(para(r, before=sp.gap_entry, tabs=True, keep=True))
        elif k == "sub":
            r = run(b[1], ital=True) + ('<w:r><w:tab/></w:r>' + run(b[2], ital=True) if b[2] else "")
            body.append(para(r, tabs=True, keep=True))
        elif k == "text":
            body.append(para("".join(run(t, bold=bo) for t, bo in b[2]) if len(b) > 2 else run(b[1])))
        elif k == "skill":
            body.append(para(run(b[1] + ": ", bold=True) + run(b[2]), numbered=True))
        elif k == "bullet":
            body.append(para("".join(run(t, bold=bo) for t, bo in (b[2] if len(b) > 2 else [(b[1], False)]) if t), numbered=True))
    mx, my = _tw(sp.margin_x), _tw(sp.margin_y)
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                f'<w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="{my}" w:right="{mx}" w:bottom="{my}" w:left="{mx}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>')
    numbering = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                 '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>'
                 f'<w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{_tw(sp.bullet_indent)}" w:hanging="{_tw(sp.bullet_indent - sp.bullet_x)}"/></w:pPr>'
                 f'<w:rPr><w:rFonts w:ascii="{sp.word}" w:hAnsi="{sp.word}"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>'
              f'<w:rFonts w:ascii="{sp.word}" w:hAnsi="{sp.word}" w:eastAsia="{sp.word}" w:cs="{sp.word}"/><w:sz w:val="{int(round(sp.size * 2))}"/><w:lang w:val="en-US"/>'
              '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
              '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>')
    name = W(clean((model.get("header") or {}).get("name") or "Resume"))
    doc_title = " - Cover Letter" if model.get("kind") == "letter" else " - Resume"
    core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + name + doc_title + '</dc:title><dc:creator>' + name + '</dc:creator></cp:coreProperties>')
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                               '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                               '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                               '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
                               '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                       '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                       '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
        "word/_rels/document.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                                        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
        "word/document.xml": document, "word/styles.xml": styles, "word/numbering.xml": numbering, "docProps/core.xml": core,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n, c in files.items():
            z.writestr(n, c)
    return buf.getvalue()


def plain_text(model):
    """Plain text of the resume (for keyword checks and copy-paste into application forms)."""
    out = []
    for b in blocks(model):
        if b[0] in ("name", "contact", "heading", "text", "line"):
            out.append(b[1])
        elif b[0] in ("entry", "sub"):
            out.append("  ".join(x for x in b[1:] if x))
        elif b[0] == "skill":
            out.append(f"{b[1]}: {b[2]}")
        elif b[0] == "bullet":
            out.append("- " + b[1])
    return "\n".join(out)


def safe_name(s):
    s = re.sub(r"[^\w\-.]+", "_", clean(s)).strip("_.")
    return (s or "Resume")[:90]


def render(model):
    """The exact layout used by both exports, for the page's live preview (drawn as SVG)."""
    size, tight, n, fill = fit(model)
    pages, sp = layout(model, size, tight)
    style = {sp.reg: "r", sp.bold: "b", sp.ital: "i"}
    out = []
    for ops in pages:
        items = []
        for op in ops:
            if op[0] == "runs":
                _, x, y, (runs, sz) = op
                cx = x
                for t, f in runs:
                    if t and not t.isspace():
                        items.append(["t", round(cx, 2), round(y, 2), subs(t), style[f], sz])
                    cx += width(t, f, sz)
            elif op[0] == "rule":
                items.append(["l", round(op[1], 2), round(op[2], 2), round(op[3], 2)])
        out.append(items)
    return {"size": size, "tight": tight, "pages": n, "fill": round(fill, 3), "font": sp.font, "render": out, "unsupported": unsupported_chars(model)}
