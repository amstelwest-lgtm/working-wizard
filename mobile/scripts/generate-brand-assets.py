#!/usr/bin/env python3
"""Build Capacitor icon and splash sources from the repo brand assets.

Reads public/icons and public/milon-wordmark.png. Writes mobile/assets
(for @capacitor/assets) and mobile/www/mark.png (offline page).
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
OUT = ROOT / "mobile" / "assets"
WWW = ROOT / "mobile" / "www"

INK = (10, 10, 10, 255)
SIZE = 1024
SPLASH = 2732
# Adaptive-icon safe zone is the inner 66%.
SAFE = int(SIZE * 0.62)


def cropped(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    box = image.getbbox()
    if box:
        image = image.crop(box)
    return image


def fit(image: Image.Image, max_w: int, max_h: int) -> Image.Image:
    scale = min(max_w / image.width, max_h / image.height)
    w = max(1, int(image.width * scale))
    h = max(1, int(image.height * scale))
    return image.resize((w, h), Image.Resampling.LANCZOS)


def paste_center(canvas: Image.Image, image: Image.Image, cx: int, cy: int) -> None:
    x = cx - image.width // 2
    y = cy - image.height // 2
    canvas.alpha_composite(image, (x, y))


def main() -> None:
    mark = cropped(PUBLIC / "icons" / "icon-512-transparent.png")
    word = cropped(PUBLIC / "milon-wordmark.png")
    OUT.mkdir(parents=True, exist_ok=True)

    foreground = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    paste_center(foreground, fit(mark, SAFE, SAFE), SIZE // 2, SIZE // 2)
    foreground.save(OUT / "icon-foreground.png")

    background = Image.new("RGBA", (SIZE, SIZE), INK)
    background.save(OUT / "icon-background.png")

    icon = background.copy()
    icon.alpha_composite(foreground)
    icon.save(OUT / "icon-only.png")

    splash = Image.new("RGBA", (SPLASH, SPLASH), INK)
    paste_center(splash, fit(mark, 720, 720), SPLASH // 2, int(SPLASH * 0.42))
    paste_center(splash, fit(word, 1500, 280), SPLASH // 2, int(SPLASH * 0.62))
    splash.save(OUT / "splash.png")
    splash.save(OUT / "splash-dark.png")

    offline = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    fitted = fit(mark, 220, 220)
    paste_center(offline, fitted, 128, 128)
    offline.save(WWW / "mark.png")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
