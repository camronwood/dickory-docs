#!/usr/bin/env python3
"""Generate Dickory Docs marketing banners (1080×1080), Neural-Junkie style."""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ICON_PATH = ROOT / "docs" / "assets" / "icon" / "apple-touch-icon.png"
SIZE = 1080

# Landing page palette (docs/css/landing.css)
BG_DEEP = (15, 14, 12)
BG_CARD = (22, 20, 18)
ACCENT = (212, 168, 75)
ACCENT_DIM = (184, 146, 58)
TEXT = (235, 232, 227)
TEXT_MUTED = (154, 148, 136)
WHITE = (255, 255, 255)


def load_fonts() -> dict[str, ImageFont.FreeTypeFont | ImageFont.ImageFont]:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    base = None
    for path in candidates:
        if Path(path).exists():
            try:
                base = path
                break
            except OSError:
                continue
    if base is None:
        return {
            "label": ImageFont.load_default(),
            "title": ImageFont.load_default(),
            "headline": ImageFont.load_default(),
            "pill": ImageFont.load_default(),
            "footer": ImageFont.load_default(),
            "oss_title": ImageFont.load_default(),
            "oss_sub": ImageFont.load_default(),
            "oss_body": ImageFont.load_default(),
            "oss_btn": ImageFont.load_default(),
        }
    return {
        "label": ImageFont.truetype(base, 28),
        "title": ImageFont.truetype(base, 92),
        "headline": ImageFont.truetype(base, 44),
        "pill": ImageFont.truetype(base, 26),
        "footer": ImageFont.truetype(base, 24),
        "oss_title": ImageFont.truetype(base, 58),
        "oss_sub": ImageFont.truetype(base, 40),
        "oss_body": ImageFont.truetype(base, 28),
        "oss_btn": ImageFont.truetype(base, 30),
    }


def radial_glow(w: int, h: int, cx: float, cy: float, radius: float, color: tuple[int, int, int, int]) -> Image.Image:
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = layer.load()
    for y in range(h):
        for x in range(w):
            d = math.hypot(x - cx, y - cy) / radius
            if d < 1:
                a = int(color[3] * (1 - d) ** 2)
                px[x, y] = (color[0], color[1], color[2], a)
    return layer


def draw_background(w: int, h: int, seed: int = 42) -> Image.Image:
    img = Image.new("RGB", (w, h), BG_DEEP)
    glow1 = radial_glow(w, h, w * 0.5, h * 0.12, w * 0.55, (*ACCENT, 55))
    glow2 = radial_glow(w, h, w * 0.92, h * 0.45, w * 0.4, (107, 83, 64, 45))
    img = Image.alpha_composite(img.convert("RGBA"), glow1).convert("RGB")
    img = Image.alpha_composite(img.convert("RGBA"), glow2).convert("RGB")

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    rng = random.Random(seed)
    nodes = [(rng.uniform(80, w - 80), rng.uniform(120, h - 120)) for _ in range(28)]
    for i, (x1, y1) in enumerate(nodes):
        for j in range(i + 1, len(nodes)):
            if rng.random() > 0.12:
                continue
            x2, y2 = nodes[j]
            draw.line([(x1, y1), (x2, y2)], fill=(*ACCENT, 28), width=1)
    for x, y in nodes:
        r = rng.randint(2, 4)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(*ACCENT, 70))

    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def draw_grid_background(w: int, h: int) -> Image.Image:
    img = draw_background(w, h, seed=7)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    step = 48
    for x in range(0, w, step):
        draw.line([(x, 0), (x, h)], fill=(255, 255, 255, 12), width=1)
    for y in range(0, h, step):
        draw.line([(0, y), (w, y)], fill=(255, 255, 255, 12), width=1)
    rng = random.Random(3)
    for _ in range(40):
        x, y = rng.randint(0, w), rng.randint(0, h)
        draw.text((x, y), "+", fill=(255, 255, 255, 35), font=ImageFont.load_default())
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def center_text(draw: ImageDraw.ImageDraw, y: int, text: str, font, fill, w: int) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text(((w - tw) // 2, y), text, font=font, fill=fill)
    return y + th


def rounded_rect(draw: ImageDraw.ImageDraw, xy: tuple, radius: int, outline: tuple, width: int = 2, fill: tuple | None = None):
    draw.rounded_rectangle(xy, radius=radius, outline=outline, width=width, fill=fill)


def paste_icon(base: Image.Image, scale: float = 1.0, y_offset: int = 0) -> None:
    if not ICON_PATH.exists():
        return
    icon = Image.open(ICON_PATH).convert("RGBA")
    side = int(180 * scale)
    icon = icon.resize((side, side), Image.Resampling.LANCZOS)
    x = (base.width - side) // 2
    y = y_offset
    base.paste(icon, (x, y), icon)


def draw_feature_pill(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    w: int,
    h: int,
    label: str,
    icon_color: tuple[int, int, int],
    fonts,
) -> None:
    rounded_rect(draw, (x, y, x + w, y + h), 14, (*ACCENT_DIM, 180), width=2, fill=(*BG_CARD, 220))
    cx, cy = x + 36, y + h // 2
    draw.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=icon_color)
    draw.text((x + 64, y + (h - 26) // 2), label, font=fonts["pill"], fill=TEXT)


def generate_social_ad(out: Path, fonts) -> None:
    w, h = SIZE, SIZE
    img = draw_background(w, h)
    draw = ImageDraw.Draw(img)

    y = 118
    y = center_text(draw, y, "BUILT FOR MERMAID", fonts["label"], TEXT_MUTED, w) + 36

    title = "DICKORY DOCS"
    bbox = draw.textbbox((0, 0), title, font=fonts["title"])
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (w - tw) // 2
    draw.text((tx, y), title, font=fonts["title"], fill=WHITE)
    # Gold underline under "DOCS"
    docs_start = tx + draw.textlength("DICKORY ", font=fonts["title"])
    docs_w = draw.textlength("DOCS", font=fonts["title"])
    uy = y + th + 8
    draw.rounded_rectangle([docs_start, uy, docs_start + docs_w, uy + 6], radius=3, fill=ACCENT)
    y += th + 52

    y = center_text(draw, y, "Stop pasting diagrams into browser tabs.", fonts["headline"], TEXT, w) + 14
    y = center_text(draw, y, "Start viewing Mermaid from your repo.", fonts["headline"], ACCENT, w) + 56

    pill_w, pill_h, gap = 310, 64, 18
    total_w = pill_w * 3 + gap * 2
    x0 = (w - total_w) // 2
    pills = [
        ("Inline SVG preview", (120, 190, 255)),
        ("Diagram gallery", (180, 130, 255)),
        ("Local-first folders", (90, 210, 170)),
    ]
    for i, (label, color) in enumerate(pills):
        draw_feature_pill(draw, x0 + i * (pill_w + gap), y, pill_w, pill_h, label, color, fonts)
    y += pill_h + 80

    center_text(draw, y, "Tauri desktop  •  Mermaid 11  •  Open source", fonts["footer"], TEXT_MUTED, w)

    img.save(out, "PNG", optimize=True)
    print(f"Wrote {out}")


def draw_simple_icon(draw: ImageDraw.ImageDraw, cx: int, cy: int, kind: str, color: tuple) -> None:
    if kind == "star":
        points = []
        for i in range(10):
            ang = math.pi / 2 + i * math.pi / 5
            r = 22 if i % 2 == 0 else 10
            points.append((cx + r * math.cos(ang), cy - r * math.sin(ang)))
        draw.polygon(points, fill=color)
    elif kind == "fork":
        draw.line([(cx, cy - 20), (cx, cy + 20)], fill=color, width=4)
        draw.arc([cx - 18, cy - 26, cx + 2, cy - 6], 90, 270, fill=color, width=4)
        draw.arc([cx - 2, cy - 26, cx + 18, cy - 6], 270, 90, fill=color, width=4)
    else:
        draw.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], outline=color, width=4)
        draw.line([(cx - 8, cy), (cx + 8, cy)], fill=color, width=4)
        draw.line([(cx, cy - 8), (cx, cy + 8)], fill=color, width=4)


def generate_oss_ad(out: Path, fonts) -> None:
    w, h = SIZE, SIZE
    img = draw_grid_background(w, h)
    draw = ImageDraw.Draw(img)

    paste_icon(img, scale=1.15, y_offset=72)
    y = 280

    y = center_text(draw, y, "BUILD WITH US", fonts["oss_title"], WHITE, w) + 20
    y = center_text(draw, y, "Dickory Docs is open source", fonts["oss_sub"], ACCENT, w) + 28
    y = center_text(draw, y, "Rust  •  Tauri  •  React  —  PRs, issues, and ideas welcome.", fonts["oss_body"], TEXT, w) + 70

    icons_y = y + 20
    labels = ["Star", "Fork", "Contribute"]
    kinds = ["star", "fork", "plus"]
    section_w = 720
    x_start = (w - section_w) // 2
    slot = section_w // 3
    for i, (label, kind) in enumerate(zip(labels, kinds)):
        cx = x_start + slot * i + slot // 2
        draw_simple_icon(draw, cx, icons_y, kind, ACCENT)
        bbox = draw.textbbox((0, 0), label, font=fonts["oss_body"])
        tw = bbox[2] - bbox[0]
        draw.text((cx - tw // 2, icons_y + 36), label, font=fonts["oss_body"], fill=TEXT)
        if i < 2:
            lx = x_start + slot * (i + 1)
            draw.line([(lx, icons_y - 10), (lx, icons_y + 58)], fill=(255, 255, 255, 40), width=1)

    btn_text = "github.com/camronwood/dickory-docs"
    btn_font = fonts["oss_btn"]
    bbox = draw.textbbox((0, 0), btn_text, font=btn_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = 48, 22
    bx0 = (w - tw) // 2 - pad_x
    by0 = h - 160
    bx1 = bx0 + tw + pad_x * 2
    by1 = by0 + th + pad_y * 2
    rounded_rect(draw, (bx0, by0, bx1, by1), 18, ACCENT, width=0, fill=ACCENT)
    draw.text((bx0 + pad_x, by0 + pad_y), btn_text, font=btn_font, fill=BG_DEEP)

    img.save(out, "PNG", optimize=True)
    print(f"Wrote {out}")


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    fonts = load_fonts()
    generate_social_ad(ASSETS / "dickory-docs-social-ad-1080.png", fonts)
    generate_oss_ad(ASSETS / "dickory-docs-oss-contributors-ad-1080.png", fonts)


if __name__ == "__main__":
    main()
