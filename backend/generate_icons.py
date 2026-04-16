#!/usr/bin/env python3
"""Run once to generate extension icons: python generate_icons.py"""
import os
from PIL import Image, ImageDraw

SIZES = [16, 48, 128]
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")


def create_icon(size: int, path: str):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    radius = size // 5
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(30, 64, 175, 255))

    margin = size // 5
    bar_w = max(1, size // 7)
    bars = [0.55, 1.0, 0.70]
    total_w = 3 * bar_w + 2 * (bar_w // 2)
    start_x = (size - total_w) // 2
    gap = bar_w // 2

    for i, h in enumerate(bars):
        x = start_x + i * (bar_w + gap)
        bar_h = int((size - 2 * margin) * h)
        y_top = size - margin - bar_h
        draw.rectangle([x, y_top, x + bar_w - 1, size - margin - 1], fill=(255, 255, 255, 230))

    img.save(path, "PNG")
    print(f"  Created {path}")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for s in SIZES:
        create_icon(s, os.path.join(OUT_DIR, f"icon{s}.png"))
    print("Done! Icons written to extension/icons/")
