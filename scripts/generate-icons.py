"""Generate ReadNook PNG icons from a small, dependency-light Pillow drawing.

This script is not part of the app build. The generated PNG files are committed
so production builds do not require Python or Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "icons"
SCALE = 4
SIZE = 512 * SCALE

BACKGROUND = "#F6EFE3"
ACCENT = "#8B5E3C"
PAGE = "#FFF9F0"
LINE = "#D9BFA5"
SPINE = "#E7D3BE"
RIBBON = "#D5A36C"


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_icon(maskable: bool = False) -> Image.Image:
    image = Image.new("RGB", (SIZE, SIZE), BACKGROUND)
    draw = ImageDraw.Draw(image)

    if maskable:
        scale = 0.78
        offset = SIZE * (1 - scale) / 2
    else:
        scale = 1.0
        offset = 0

    def s(value: float) -> int:
        return int(value * SCALE * scale + offset)

    # Book boards
    rounded(draw, (s(90), s(137), s(422), s(393)), s(48), ACCENT)

    # Left and right pages, each with a quiet inner curve.
    rounded(draw, (s(122), s(149), s(256), s(369)), s(27), PAGE)
    rounded(draw, (s(256), s(149), s(390), s(369)), s(27), PAGE)
    draw.rectangle((s(122), s(304), s(256), s(369)), fill=PAGE)
    draw.rectangle((s(256), s(304), s(390), s(369)), fill=PAGE)

    # Spine
    draw.line((s(256), s(187), s(256), s(369)), fill=SPINE, width=s(7))

    # Page rules
    for y in (208, 242, 276):
        width = 57 if y != 276 else 40
        draw.line(
            (s(154), s(y), s(154 + width), s(y)),
            fill=LINE,
            width=s(9),
        )
        draw.line(
            (s(301), s(y), s(301 + width), s(y)),
            fill=LINE,
            width=s(9),
        )

    # Bookmark ribbon
    draw.polygon(
        [
            (s(256), s(142)),
            (s(276), s(142)),
            (s(276), s(214)),
            (s(266), s(205)),
            (s(256), s(214)),
        ],
        fill=RIBBON,
    )

    return image


def save(image: Image.Image, name: str, size: int) -> None:
    resized = image.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(OUT / name, format="PNG", optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    standard = draw_icon(maskable=False)
    maskable = draw_icon(maskable=True)
    save(standard, "icon-192.png", 192)
    save(standard, "icon-512.png", 512)
    save(standard, "apple-touch-icon-180.png", 180)
    save(maskable, "icon-maskable-512.png", 512)
    print("Generated ReadNook icons in", OUT)


if __name__ == "__main__":
    main()
