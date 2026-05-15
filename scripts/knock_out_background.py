#!/usr/bin/env python3
"""
Remove light squircle / gradient backgrounds from an app icon PNG.

Uses edge-only flood fill: pixels must connect to the image border through
mostly-grayscale, fairly bright pixels. Saturated colors (blues, etc.) block
the flood so the artwork stays opaque.

Usage (venv with Pillow + numpy):
  dickory-docs/.venv-icon/bin/python scripts/knock_out_background.py \\
    assets/source-app-icon.png -o app-icon-source.png

Then:
  npx @tauri-apps/cli icon app-icon-source.png
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def luminance(rgb: np.ndarray) -> np.ndarray:
    r = rgb[..., 0].astype(np.float64)
    g = rgb[..., 1].astype(np.float64)
    b = rgb[..., 2].astype(np.float64)
    return 0.299 * r + 0.587 * g + 0.114 * b


def saturation(rgb: np.ndarray) -> np.ndarray:
    """HSV-style saturation in 0..1."""
    r = rgb[..., 0].astype(np.float64)
    g = rgb[..., 1].astype(np.float64)
    b = rgb[..., 2].astype(np.float64)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    out = np.zeros_like(mx)
    mask = mx > 1e-6
    out[mask] = (mx - mn)[mask] / mx[mask]
    return out


def _edge_flood_mask(
    can_fill: np.ndarray,
    seeds: np.ndarray,
) -> np.ndarray:
    h, w = can_fill.shape
    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for y in range(h):
        for x in range(w):
            if seeds[y, x]:
                visited[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            ny, nx = y + dy, x + dx
            if ny < 0 or ny >= h or nx < 0 or nx >= w:
                continue
            if visited[ny, nx] or not can_fill[ny, nx]:
                continue
            visited[ny, nx] = True
            q.append((ny, nx))

    return visited


def knock_out_rgba(
    arr: np.ndarray,
    *,
    lum_seed: float,
    lum_fill: float,
    sat_max: float,
) -> np.ndarray:
    """Return new RGBA array with edge-connected light background cleared to transparent."""
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.float64)
    L = luminance(rgb)
    S = saturation(rgb)

    can_fill = (L >= lum_fill) & (S <= sat_max)

    edge = np.zeros((h, w), dtype=bool)
    edge[0, :] = edge[-1, :] = True
    edge[:, 0] = edge[:, -1] = True

    seeds = edge & can_fill & (L >= lum_seed)
    visited = _edge_flood_mask(can_fill, seeds)

    out = arr.copy()
    out[:, :, 3] = np.where(visited, 0, out[:, :, 3])
    return out


def knock_out_dark_rgba(
    arr: np.ndarray,
    *,
    lum_seed: float,
    lum_fill: float,
    sat_max: float,
) -> np.ndarray:
    """Return new RGBA array with edge-connected dark/black background cleared to transparent."""
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.float64)
    L = luminance(rgb)
    S = saturation(rgb)

    can_fill = (L <= lum_fill) & (S <= sat_max)

    edge = np.zeros((h, w), dtype=bool)
    edge[0, :] = edge[-1, :] = True
    edge[:, 0] = edge[:, -1] = True

    seeds = edge & can_fill & (L <= lum_seed)
    visited = _edge_flood_mask(can_fill, seeds)

    out = arr.copy()
    out[:, :, 3] = np.where(visited, 0, out[:, :, 3])
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Knock out light background from PNG icon.")
    ap.add_argument("input", type=Path, help="Source PNG path")
    ap.add_argument("-o", "--output", type=Path, required=True, help="Output PNG path")
    ap.add_argument(
        "--lum-seed",
        type=float,
        default=175.0,
        help="Min luminance on border to start flood (0–255). Default 175.",
    )
    ap.add_argument(
        "--lum-fill",
        type=float,
        default=135.0,
        help="Min luminance for interior continuation (allows darker gradient). Default 135.",
    )
    ap.add_argument(
        "--sat-max",
        type=float,
        default=0.42,
        help="Max saturation for background pixels (blocks saturated blues). Default 0.42.",
    )
    ap.add_argument(
        "--bg",
        choices=("light", "dark"),
        default="light",
        help="Background type to remove: light squircle/gradient (default) or dark/black.",
    )
    ap.add_argument(
        "--lum-seed-dark",
        type=float,
        default=55.0,
        help="Max luminance on border to start dark flood (0–255). Default 55.",
    )
    ap.add_argument(
        "--lum-fill-dark",
        type=float,
        default=75.0,
        help="Max luminance for dark interior continuation. Default 75.",
    )
    args = ap.parse_args()

    img = Image.open(args.input).convert("RGBA")
    arr = np.asarray(img)
    if args.bg == "dark":
        out = knock_out_dark_rgba(
            arr,
            lum_seed=args.lum_seed_dark,
            lum_fill=args.lum_fill_dark,
            sat_max=args.sat_max,
        )
    else:
        out = knock_out_rgba(
            arr,
            lum_seed=args.lum_seed,
            lum_fill=args.lum_fill,
            sat_max=args.sat_max,
        )
    result = Image.fromarray(out, mode="RGBA")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output, format="PNG")
    print(f"Wrote {args.output} ({result.size[0]}×{result.size[1]})")


if __name__ == "__main__":
    main()
