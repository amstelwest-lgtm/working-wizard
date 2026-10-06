"""Retired composer for the landing #proof cards.

public/proof now holds real dark-theme Sample Co. captures:
ratio-dso, signoff-stamp, and action-plan-review. Do not run this
script to replace them.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "public" / "proof"
W, H = 1600, 1200
BG = (11, 14, 20)
PANEL = (22, 26, 36)
PANEL_2 = (16, 19, 28)
GOLD = (212, 175, 55)
INK = (236, 232, 220)
DIM = (168, 162, 150)
LINE = (58, 52, 40)
OK = (92, 207, 138)
WARN = (232, 179, 75)
WAIT = (232, 179, 75)

SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(BOLD if bold else SANS, size)


def rounded(draw: ImageDraw.ImageDraw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def chrome(draw: ImageDraw.ImageDraw, title: str):
    rounded(draw, (36, 28, W - 36, 108), 18, PANEL, LINE, 2)
    draw.ellipse((60, 52, 84, 76), fill=GOLD)
    draw.text((100, 48), "SAMPLE CO.", font=font(22, True), fill=GOLD)
    draw.text((100, 76), "Sample workspace", font=font(16), fill=DIM)
    draw.text((W - 420, 56), title, font=font(20, True), fill=INK)


def base() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, W, 8), fill=GOLD)
    return img


def ratio() -> Image.Image:
    img = base()
    draw = ImageDraw.Draw(img)
    chrome(draw, "Days sales outstanding")
    rounded(draw, (36, 136, W - 36, H - 36), 22, PANEL_2, LINE, 2)
    draw.text((72, 168), "Days sales outstanding", font=font(40, True), fill=INK)
    draw.text((72, 224), "Receivables ÷ revenue × 365", font=font(22), fill=DIM)
    rounded(draw, (72, 290, 520, 470), 18, PANEL, GOLD, 2)
    draw.text((100, 314), "52", font=font(92, True), fill=GOLD)
    draw.text((280, 360), "days", font=font(28), fill=INK)
    rows = [
        ("Receivables", "$184,000"),
        ("Revenue", "$1,292,308"),
        ("Days in the year", "365"),
    ]
    y = 520
    for label, value in rows:
        draw.text((72, y), label, font=font(26), fill=DIM)
        draw.text((980, y), value, font=font(28, True), fill=INK)
        y += 36
        draw.line((72, y, W - 108, y), fill=LINE, width=2)
        y += 28
    draw.text((72, 820), "Workings", font=font(18, True), fill=GOLD)
    draw.text((72, 860), "184,000  ÷  1,292,308  ×  365  =  52 days", font=font(28), fill=INK)
    draw.text(
        (72, 980),
        "Missing inputs stay blank on this row. Milōn does not fill them in.",
        font=font(22),
        fill=DIM,
    )
    return img


def signoff() -> Image.Image:
    img = base()
    draw = ImageDraw.Draw(img)
    chrome(draw, "Advisory report")
    rounded(draw, (36, 136, W - 36, 760), 22, PANEL_2, LINE, 2)
    draw.text((72, 176), "Advisory pack", font=font(36, True), fill=INK)
    draw.text((72, 232), "Sample Co.  ·  October 2026", font=font(22), fill=DIM)
    lines = [
        "Health score 78. Cash is the weak pillar.",
        "Days sales outstanding is 52, from the receivables",
        "and revenue on file. Three moves close the week-6 dip.",
    ]
    y = 320
    for line in lines:
        draw.text((72, y), line, font=font(26), fill=INK)
        y += 48
    rounded(draw, (36, 800, W - 36, H - 36), 22, (28, 24, 14), GOLD, 2)
    draw.text((72, 840), "REVIEWED & SIGNED OFF BY", font=font(18, True), fill=GOLD)
    draw.text((72, 890), "A. Sample, CA(SA)", font=font(40, True), fill=INK)
    draw.text((72, 960), "6 Oct 2026", font=font(28), fill=INK)
    draw.text((72, 1040), "Name and date only. No firm is printed on this stamp.", font=font(20), fill=DIM)
    return img


def bot() -> Image.Image:
    img = base()
    draw = ImageDraw.Draw(img)
    chrome(draw, "Milōn Bot")
    steps = [
        (True, "Read the statements on file", "Done"),
        (True, "Calculate the health score and 19 ratios", "Done"),
        (True, "Build the 13-week cash forecast", "Done"),
        (False, "Draft the advisory pack", "Waiting for accountant approval"),
    ]
    y = 150
    for done, title, status in steps:
        rounded(draw, (36, y, W - 36, y + 210), 22, PANEL_2, GOLD if not done else LINE, 2)
        color = OK if done else WAIT
        draw.ellipse((72, y + 70, 132, y + 130), outline=color, width=4)
        if done:
            draw.line((88, y + 102, 108, y + 122), fill=color, width=5)
            draw.line((108, y + 122, 124, y + 86), fill=color, width=5)
        else:
            draw.ellipse((94, y + 92, 110, y + 108), fill=color)
        draw.text((168, y + 48), title, font=font(32, True), fill=INK)
        draw.text((168, y + 108), status, font=font(24), fill=color)
        y += 234
    draw.text(
        (48, H - 52),
        "Stops here. The next decision is yours.",
        font=font(22),
        fill=DIM,
    )
    return img


def save_set(name: str, image: Image.Image) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for width in (1600, 1200, 800, 480):
        height = round(H * width / W)
        frame = image if width == W else image.resize((width, height), Image.Resampling.LANCZOS)
        path = ROOT / f"{name}-{width}.webp"
        frame.save(path, "WEBP", quality=80, method=6)
        print(f"{path.relative_to(ROOT.parent.parent)}  {path.stat().st_size // 1024}KB")


def main() -> None:
    raise SystemExit(
        "Refusing to overwrite real public/proof captures "
        "(ratio-dso, signoff-stamp, action-plan-review)."
    )


if __name__ == "__main__":
    main()
