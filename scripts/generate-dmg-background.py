#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "dmg-background.png"
OUTPUT_RETINA = ROOT / "assets" / "dmg-background@2x.png"


def point(value, scale):
    return int(round(value * scale))


def draw_grid(draw, width, height, scale):
    top_color = (226, 230, 235, 160)
    bottom_color = (220, 224, 230, 150)
    center_x = width / 2
    horizon_y = point(150, scale)
    spacing = point(24, scale)

    for x in range(-spacing * 6, width + spacing * 7, spacing):
        draw.line([(x, 0), (x, horizon_y)], fill=top_color, width=max(1, point(1, scale)))

        points = []
        for step in range(0, 90):
            t = step / 89
            y = horizon_y + (height - horizon_y) * t
            bend = 1 + 1.15 * (t ** 1.9)
            curved_x = center_x + (x - center_x) * bend
            points.append((curved_x, y))
        draw.line(points, fill=bottom_color, width=max(1, point(1, scale)))

    for y in range(0, horizon_y + spacing, spacing):
        draw.line([(0, y), (width, y)], fill=top_color, width=max(1, point(1, scale)))

    for index in range(1, 8):
        t = index / 8
        y = horizon_y + (height - horizon_y) * (t ** 1.26)
        draw.line([(0, y), (width, y)], fill=bottom_color, width=max(1, point(1, scale)))


def draw_arrow(draw, scale):
    black = (28, 28, 28, 255)
    y = point(156, scale)
    start_x = point(207, scale)
    end_x = point(265, scale)
    line_width = point(2.2, scale)
    head = point(10, scale)

    draw.line([(start_x, y), (end_x, y)], fill=black, width=line_width)
    draw.line([(end_x, y), (end_x - head, y - head)], fill=black, width=line_width)
    draw.line([(end_x, y), (end_x - head, y + head)], fill=black, width=line_width)


def make_background(scale):
    width = point(480, scale)
    height = point(313, scale)
    image = Image.new("RGBA", (width, height), (250, 250, 250, 255))
    draw = ImageDraw.Draw(image, "RGBA")
    draw_grid(draw, width, height, scale)
    draw_arrow(draw, scale)
    return image


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    make_background(1).save(OUTPUT)
    make_background(2).save(OUTPUT_RETINA)
    print(f"Wrote {OUTPUT}")
    print(f"Wrote {OUTPUT_RETINA}")


if __name__ == "__main__":
    main()
