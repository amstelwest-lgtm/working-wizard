#!/usr/bin/env python3
"""Render Milōn Lighthouse one-pagers (accountant + owner) — A4 portrait."""
from pathlib import Path
from fpdf import FPDF
ASSETS = Path(__file__).resolve().parent
FONTS = ASSETS / "fonts"
REPO_ROOT = ASSETS.parent.parent
NAVY = (15, 32, 64)
NAVY_MID = (30, 55, 95)
ACCENT = (20, 80, 140)
LIGHT_BG = (245, 247, 250)
WHITE = (255, 255, 255)
BODY = (40, 48, 60)
MUTED = (90, 100, 115)
LINE = (210, 216, 225)
class OnePager(FPDF):
    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_auto_page_break(auto=False)
        self.add_font("DejaVu", "", str(FONTS / "DejaVuSans.ttf"))
        self.add_font("DejaVu", "B", str(FONTS / "DejaVuSans-Bold.ttf"))
        self.set_margins(14, 12, 14)
    def header_bar(self, brand_line: str):
        self.set_fill_color(*NAVY)
        self.rect(0, 0, 210, 18, "F")
        self.set_xy(14, 5)
        self.set_font("DejaVu", "B", 14)
        self.set_text_color(*WHITE)
        self.cell(0, 8, "MIL\u014cN", align="L")
        self.set_xy(14, 5)
        self.set_font("DejaVu", "", 8)
        self.cell(0, 8, brand_line, align="R")
    def footer_bar(self):
        self.set_fill_color(*NAVY)
        self.rect(0, 285, 210, 12, "F")
        self.set_xy(14, 288)
        self.set_font("DejaVu", "", 7.5)
        self.set_text_color(*WHITE)
        self.cell(0, 6, "milonfinance.com  \u00b7  Know your numbers. Sleep at night.", align="C")
    def section_label(self, y: float, text: str) -> float:
        self.set_xy(14, y)
        self.set_font("DejaVu", "B", 8)
        self.set_text_color(*ACCENT)
        self.cell(0, 5, text.upper())
        return y + 6
    def hrule(self, y: float) -> float:
        self.set_draw_color(*LINE)
        self.set_line_width(0.2)
        self.line(14, y, 196, y)
        return y + 3
def render_accountant(path: Path):
    pdf = OnePager()
    pdf.add_page()
    pdf.header_bar("Firm advisory  \u00b7  milonfinance.com")
    y = 24
    pdf.set_xy(14, y)
    pdf.set_font("DejaVu", "B", 15)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(182, 6.5, "Turn compliance clients into monthly advisory retainers \u2014 without hiring more juniors.")
    y = pdf.get_y() + 3
    pdf.set_xy(14, y)
    pdf.set_font("DejaVu", "", 9)
    pdf.set_text_color(*BODY)
    pdf.multi_cell(182, 4.5, "MIL\u014cN is the shared workspace between you and every client: one health score, a 13-week cash view, and AI-drafted advisory they actually open \u2014 under your brand.")
    y = pdf.get_y() + 4
    y = pdf.hrule(y)
    y = pdf.section_label(y, "The problem")
    problems = [
        "Clients ask \u201chow are we doing?\u201d between year-ends. You answer with hours you can\u2019t bill cleanly.",
        "Spreadsheets and annual packs don\u2019t scale across a book of 50\u2013150 SMEs.",
        "Advisory revenue is stuck behind capacity, not demand.",
    ]
    pdf.set_font("DejaVu", "", 8.5)
    pdf.set_text_color(*BODY)
    for p in problems:
        pdf.set_xy(16, y)
        pdf.set_text_color(*ACCENT)
        pdf.cell(4, 4.2, "\u2022")
        pdf.set_text_color(*BODY)
        pdf.multi_cell(178, 4.2, p)
        y = pdf.get_y() + 1.2
    y += 2
    y = pdf.hrule(y)
    y = pdf.section_label(y, "What you get")
    benefits = [
        ("Multi-client dashboard", "Live health across the portfolio; spot drift before the panic call."),
        ("AI advisory drafter", "Claude drafts; you refine, sign off, send as the firm."),
        ("White-label reports", "Your brand on every portal and pack."),
        ("Risk radar", "Deteriorating clients flagged early."),
        ("Retainer model", "Designed / planned economics: ~R1 200+ / ~$70+ uplift per client / month (not a guarantee)."),
    ]
    for title, desc in benefits:
        pdf.set_xy(16, y)
        pdf.set_font("DejaVu", "B", 8.5)
        pdf.set_text_color(*NAVY)
        pdf.cell(pdf.get_string_width(title) + 2, 4.2, title)
        pdf.set_font("DejaVu", "", 8.5)
        pdf.set_text_color(*BODY)
        x_after = pdf.get_x()
        pdf.set_xy(x_after, y)
        pdf.multi_cell(196 - x_after, 4.2, "  \u2014  " + desc)
        y = pdf.get_y() + 1.5
    y += 1.5
    y = pdf.hrule(y)
    y = pdf.section_label(y, "How it works")
    steps = [
        "Firm account \u2192 invite clients (or upload statements / connect books)",
        "MIL\u014cN scores 4 pillars + 31 ratios \u2192 one health score",
        "You send a monthly advisory touch in minutes, not hours",
    ]
    box_w, gap, start_x, box_h = 58, 4, 14, 18
    for i, step in enumerate(steps):
        x = start_x + i * (box_w + gap)
        pdf.set_fill_color(*LIGHT_BG)
        pdf.set_draw_color(*LINE)
        pdf.rect(x, y, box_w, box_h, "DF")
        pdf.set_xy(x + 2, y + 1.5)
        pdf.set_font("DejaVu", "B", 9)
        pdf.set_text_color(*ACCENT)
        pdf.cell(box_w - 4, 4, f"{i + 1}")
        pdf.set_xy(x + 2, y + 6)
        pdf.set_font("DejaVu", "", 7.5)
        pdf.set_text_color(*BODY)
        pdf.multi_cell(box_w - 4, 3.5, step)
    y += box_h + 5
    y = pdf.hrule(y)
    y = pdf.section_label(y, "Trust")
    pdf.set_xy(14, y)
    pdf.set_font("DejaVu", "", 8)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(182, 4, "Built for SA SMEs & US SMBs  \u00b7  SAICA-referenced ratios (ZA)  \u00b7  End-to-end encrypted  \u00b7  Live sync")
    y = pdf.get_y() + 3
    pdf.set_xy(14, y)
    pdf.set_font("DejaVu", "", 7.5)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(182, 3.8, "Accountant plans planned: up to 150 clients / unlimited \u00b7 white-label included \u00b7 early access / Spark free for pilots")
    y = pdf.get_y() + 5
    pdf.set_fill_color(*NAVY)
    pdf.rect(14, y, 182, 16, "F")
    pdf.set_xy(14, y + 3)
    pdf.set_font("DejaVu", "B", 11)
    pdf.set_text_color(*WHITE)
    pdf.cell(182, 5, "See the advisory revenue model  \u2192  milonfinance.com", align="C")
    pdf.set_xy(14, y + 9)
    pdf.set_font("DejaVu", "", 8)
    pdf.cell(182, 4, "Set up your firm account  \u00b7  Free pilot / Spark for early firms", align="C")
    pdf.footer_bar()
    pdf.output(str(path))
def render_owner(path: Path):
    pdf = OnePager()
    pdf.add_page()
    pdf.header_bar("Business health  \u00b7  milonfinance.com")
    y = 24
    pdf.set_xy(14, y)
    pdf.set_font("DejaVu", "B", 18)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(182, 7, "Know your numbers. Sleep at night.")
    y = pdf.get_y() + 3
    pdf.set_xy(14, y)
    pdf.set_font("DejaVu", "", 9)
    pdf.set_text_color(*BODY)
    pdf.multi_cell(182, 4.5, "Most owners find out about a cash crisis when it\u2019s already here. MIL\u014cN shows your business health as one score \u2014 where the problem lives, what it\u2019s costing you, and what to do next.")
    y = pdf.get_y() + 4
    y = pdf.hrule(y)
    y = pdf.section_label(y, "The problem")
    problems = [
        "You see your accountant once a quarter. The business doesn\u2019t wait.",
        "Software reports the past. You need next week\u2019s cash.",
        "Advice arrives as a 40-page pack nobody remembers.",
    ]
    pdf.set_font("DejaVu", "", 8.5)
    for p in problems:
        pdf.set_xy(16, y)
        pdf.set_text_color(*ACCENT)
        pdf.cell(4, 4.2, "\u2022")
        pdf.set_text_color(*BODY)
        pdf.multi_cell(178, 4.2, p)
        y = pdf.get_y() + 1.2
    y += 2
    y = pdf.hrule(y)
    y = pdf.section_label(y, "What you see")
    benefits = [
        ("One health score", "Truth, not theater."),
        ("13-week cash forecast", "See dips weeks early."),
        ("Four pillars", "Profit \u00b7 Cash \u00b7 Assets \u00b7 Financing."),
        ("Next moves", "930+ ranked fixes in plain language."),
        ("Accountant notes on the number", "Same screen, both sides."),
    ]
    for title, desc in benefits:
        pdf.set_xy(16, y)
        pdf.set_font("DejaVu", "B", 8.5)
        pdf.set_text_color(*NAVY)
        pdf.cell(pdf.get_string_width(title) + 2, 4.2, title)
        pdf.set_font("DejaVu", "", 8.5)
        pdf.set_text_color(*BODY)
        x_after = pdf.get_x()
        pdf.set_xy(x_after, y)
        pdf.multi_cell(196 - x_after, 4.2, "  \u2014  " + desc)
        y = pdf.get_y() + 1.5
    y += 1.5
    y = pdf.hrule(y)
    y = pdf.section_label(y, "How it works")
    steps = [
        "Upload financials / connect QuickBooks (or your accountant does)",
        "Score in under a minute after processing",
        "Open it anytime \u2014 phone-friendly, no meeting required",
    ]
    box_w, gap, start_x, box_h = 58, 4, 14, 18
    for i, step in enumerate(steps):
        x = start_x + i * (box_w + gap)
        pdf.set_fill_color(*LIGHT_BG)
        pdf.set_draw_color(*LINE)
        pdf.rect(x, y, box_w, box_h, "DF")
        pdf.set_xy(x + 2, y + 1.5)
        pdf.set_font("DejaVu", "B", 9)
        pdf.set_text_color(*ACCENT)
        pdf.cell(box_w - 4, 4, f"{i + 1}")
        pdf.set_xy(x + 2, y + 6)
        pdf.set_font("DejaVu", "", 7.5)
        pdf.set_text_color(*BODY)
        pdf.multi_cell(box_w - 4, 3.5, step)
    y += box_h + 5
    y = pdf.hrule(y)
    pdf.set_fill_color(*LIGHT_BG)
    pdf.rect(14, y, 182, 14, "F")
    pdf.set_xy(16, y + 2)
    pdf.set_font("DejaVu", "B", 8.5)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(178, 4, "MIL\u014cN doesn\u2019t replace your accountant.")
    pdf.set_xy(16, y + 7)
    pdf.set_font("DejaVu", "", 8)
    pdf.set_text_color(*BODY)
    pdf.multi_cell(178, 3.8, "It closes the gap between their numbers and your decisions \u2014 monthly, not once a year.")
    y += 17
    y = pdf.hrule(y)
    y = pdf.section_label(y, "Trust")
    pdf.set_xy(14, y)
    pdf.set_font("DejaVu", "", 8)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(182, 4, "Encrypted  \u00b7  Built for SA & US  \u00b7  Free Spark / first health score")
    y = pdf.get_y() + 5
    pdf.set_fill_color(*NAVY)
    pdf.rect(14, y, 182, 18, "F")
    pdf.set_xy(14, y + 3)
    pdf.set_font("DejaVu", "B", 11)
    pdf.set_text_color(*WHITE)
    pdf.cell(182, 5, "Get my free health score  \u2192  milonfinance.com", align="C")
    pdf.set_xy(14, y + 10)
    pdf.set_font("DejaVu", "", 8)
    pdf.cell(182, 4, "I\u2019m an accountant \u2014 show me the margin  \u00b7  milonfinance.com", align="C")
    pdf.footer_bar()
    pdf.output(str(path))
if __name__ == "__main__":
    out = REPO_ROOT / "public" / "lighthouse"
    out.mkdir(parents=True, exist_ok=True)
    render_accountant(out / "milon-one-pager-accountants.pdf")
    render_owner(out / "milon-one-pager-owners.pdf")
