#!/usr/bin/env python3
"""
Generates app-icon-source.png (1024×1024) for Dickory Docs using stdlib only.

  python3 scripts/generate-placeholder-icon.py
  npx @tauri-apps/cli icon app-icon-source.png
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PNG = ROOT / "app-icon-source.png"

# RGB
BG = (0x11, 0x64, 0xA3)
PAGE = (0xF3, 0xF4, 0xF6)
LINE = (0x94, 0xA3, 0xB8)
FOLD = (0xE2, 0xE8, 0xF0)


def write_png(path: Path, width: int, height: int, rgb_rows: list[bytes]) -> None:
    """Minimal RGB PNG writer (no Pillow)."""
    raw = b"".join([b"\x00" + row for row in rgb_rows])
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def in_round_rect(x: int, y: int, x0: float, y0: float, x1: float, y1: float, rad: float) -> bool:
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    r = rad

    def dist2(ax: float, ay: float) -> float:
        dx = x - ax
        dy = y - ay
        return dx * dx + dy * dy

    if x < x0 + r:
        if y < y0 + r:
            return dist2(x0 + r, y0 + r) <= r * r
        if y > y1 - r:
            return dist2(x0 + r, y1 - r) <= r * r
    elif x > x1 - r:
        if y < y0 + r:
            return dist2(x1 - r, y0 + r) <= r * r
        if y > y1 - r:
            return dist2(x1 - r, y1 - r) <= r * r
    return True


def in_poly(px: int, py: int, pts: list[tuple[float, float]]) -> bool:
    """Ray casting."""
    n = len(pts)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def main() -> None:
    size = 1024
    m = 130
    x0, y0 = m, m + 48
    x1, y1 = size - m, size - m - 32
    rad = 40

    rows: list[bytes] = []
    for y in range(size):
        row = bytearray(size * 3)
        for x in range(size):
            i = x * 3
            r, g, b = BG
            # Page
            if in_round_rect(x, y, float(x0), float(y0), float(x1), float(y1), float(rad)):
                r, g, b = PAGE
            # Fold (triangle)
            fold_pts = [
                (float(size - m - 6), float(y0)),
                (float(size - m - 6), float(y0 + 112)),
                (float(size - m - 118), float(y0)),
            ]
            if in_poly(x, y, fold_pts):
                r, g, b = FOLD

            # Lines (only when on page body)
            if in_round_rect(x, y, float(x0), float(y0), float(x1), float(y1), float(rad)):
                lx0, lx1 = x0 + 64, x1 - 64
                yy = y0 + 200
                gap = 48
                for li in range(7):
                    chop = 140 if li % 4 == 3 else 0
                    rx1 = lx1 - chop
                    if lx0 <= x <= rx1 and yy <= y <= yy + 16:
                        r, g, b = LINE
                    yy += gap

            row[i : i + 3] = bytes((r, g, b))
        rows.append(bytes(row))

    write_png(OUT_PNG, size, size, rows)
    print(f"Wrote {OUT_PNG}")


if __name__ == "__main__":
    main()
