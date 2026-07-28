from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


BRAND_BACKGROUND = (243, 245, 242, 255)
FOREGROUND_CANVAS = 1024
SAFE_SUBJECT_SIZE = 610


def subject_mask(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    saturation = np.divide(
        maximum - minimum,
        maximum,
        out=np.zeros_like(maximum),
        where=maximum > 0,
    )

    # The generated subject is red/green, while the background and shadow are neutral.
    seed = ((saturation >= 0.16) & (maximum <= 0.99)).astype(np.uint8) * 255
    seed_image = Image.fromarray(seed, mode="L")
    seed_image = seed_image.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))

    # Flood-fill only edge-connected empty space. The neutral clock face is enclosed by
    # the saturated bezel, so it remains foreground without semantic segmentation.
    filled = seed_image.copy()
    ImageDraw.floodfill(filled, (0, 0), 128, border=255, thresh=0)
    values = np.asarray(filled)
    enclosed = np.where(values == 128, 0, 255).astype(np.uint8)

    mask = Image.fromarray(enclosed, mode="L")
    return mask.filter(ImageFilter.GaussianBlur(1.0))


def fit_foreground(image: Image.Image, mask: Image.Image) -> tuple[Image.Image, dict[str, int]]:
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("No foreground was detected")

    subject = image.convert("RGBA").crop(bbox)
    subject.putalpha(mask.crop(bbox))
    subject = decontaminate_edges(subject)
    width, height = subject.size
    scale = SAFE_SUBJECT_SIZE / max(width, height)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    subject = subject.resize(size, Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (FOREGROUND_CANVAS, FOREGROUND_CANVAS), (0, 0, 0, 0))
    offset = ((FOREGROUND_CANVAS - size[0]) // 2, (FOREGROUND_CANVAS - size[1]) // 2)
    canvas.alpha_composite(subject, offset)
    return canvas, {
        "sourceLeft": bbox[0],
        "sourceTop": bbox[1],
        "sourceRight": bbox[2],
        "sourceBottom": bbox[3],
        "foregroundWidth": size[0],
        "foregroundHeight": size[1],
        "foregroundLeft": offset[0],
        "foregroundTop": offset[1],
    }


def decontaminate_edges(image: Image.Image) -> Image.Image:
    values = np.asarray(image, dtype=np.uint8).copy()
    alpha = values[:, :, 3]
    visible = alpha > 0
    filled = alpha >= 250
    rgb = values[:, :, :3].astype(np.float32)

    # Propagate colors from opaque subject pixels into the translucent antialias fringe.
    # Alpha is left untouched, so this removes the light-background halo without changing
    # the silhouette or inventing new edge coverage.
    for _ in range(12):
        pending = visible & ~filled
        if not pending.any():
            break
        total = np.zeros_like(rgb)
        count = np.zeros(alpha.shape, dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted_filled = np.roll(filled, (dy, dx), axis=(0, 1))
            shifted_rgb = np.roll(rgb, (dy, dx), axis=(0, 1))
            if dy == -1:
                shifted_filled[-1, :] = False
            elif dy == 1:
                shifted_filled[0, :] = False
            if dx == -1:
                shifted_filled[:, -1] = False
            elif dx == 1:
                shifted_filled[:, 0] = False
            total += shifted_rgb * shifted_filled[:, :, None]
            count += shifted_filled
        reached = pending & (count > 0)
        rgb[reached] = total[reached] / count[reached, None]
        filled[reached] = True

    values[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(values, mode="RGBA")


def rescale_subject(foreground: Image.Image, maximum: int) -> Image.Image:
    bbox = foreground.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("Transparent foreground has no visible pixels")
    subject = foreground.crop(bbox)
    scale = maximum / max(subject.size)
    size = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
    subject = subject.resize(size, Image.Resampling.LANCZOS)
    result = Image.new("RGBA", foreground.size, (0, 0, 0, 0))
    result.alpha_composite(subject, ((result.width - size[0]) // 2, (result.height - size[1]) // 2))
    return result


def write_android_resources(foreground: Image.Image, resource_root: Path) -> None:
    densities = {
        "mdpi": (108, 48),
        "hdpi": (162, 72),
        "xhdpi": (216, 96),
        "xxhdpi": (324, 144),
        "xxxhdpi": (432, 192),
    }
    legacy_foreground = rescale_subject(foreground, round(FOREGROUND_CANVAS * 0.80))
    legacy = Image.new("RGBA", foreground.size, BRAND_BACKGROUND)
    legacy.alpha_composite(legacy_foreground)
    round_mask = Image.new("L", foreground.size, 0)
    ImageDraw.Draw(round_mask).ellipse((0, 0, foreground.width - 1, foreground.height - 1), fill=255)
    legacy_round = legacy.copy()
    legacy_round.putalpha(round_mask)

    for density, (foreground_size, legacy_size) in densities.items():
        directory = resource_root / f"mipmap-{density}"
        directory.mkdir(parents=True, exist_ok=True)
        foreground.resize((foreground_size, foreground_size), Image.Resampling.LANCZOS).save(
            directory / "ic_launcher_foreground.png",
            optimize=True,
        )
        legacy.resize((legacy_size, legacy_size), Image.Resampling.LANCZOS).save(
            directory / "ic_launcher.png",
            optimize=True,
        )
        legacy_round.resize((legacy_size, legacy_size), Image.Resampling.LANCZOS).save(
            directory / "ic_launcher_round.png",
            optimize=True,
        )


def write_web_resources(foreground: Image.Image, resource_root: Path) -> None:
    resource_root.mkdir(parents=True, exist_ok=True)
    web_foreground = rescale_subject(foreground, round(FOREGROUND_CANVAS * 0.80))
    icon = Image.new("RGBA", foreground.size, BRAND_BACKGROUND)
    icon.alpha_composite(web_foreground)
    for size in (192, 512):
        icon.resize((size, size), Image.Resampling.LANCZOS).save(
            resource_root / f"blockcolc-{size}.png",
            optimize=True,
        )


def checkerboard(size: int, cell: int = 32) -> Image.Image:
    result = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(result)
    colors = ((222, 226, 222, 255), (247, 248, 247, 255))
    for y in range(0, size, cell):
        for x in range(0, size, cell):
            draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=colors[(x // cell + y // cell) % 2])
    return result


def masked_preview(composite: Image.Image, kind: str) -> Image.Image:
    size = composite.width
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    inset = round(size * 0.08)
    bounds = (inset, inset, size - inset, size - inset)
    if kind == "circle":
        draw.ellipse(bounds, fill=255)
    elif kind == "rounded":
        draw.rounded_rectangle(bounds, radius=round(size * 0.22), fill=255)
    else:
        draw.rounded_rectangle(bounds, radius=round(size * 0.08), fill=255)
    result = composite.copy()
    result.putalpha(mask)
    return result


def preview_sheet(composite: Image.Image) -> Image.Image:
    tile_size = 384
    gap = 40
    margin = 48
    sheet = Image.new("RGBA", (margin * 2 + tile_size * 3 + gap * 2, tile_size + margin * 2), (36, 43, 39, 255))
    for index, kind in enumerate(("circle", "rounded", "square")):
        tile = masked_preview(composite, kind).resize((tile_size, tile_size), Image.Resampling.LANCZOS)
        x = margin + index * (tile_size + gap)
        sheet.alpha_composite(tile, (x, margin))
    return sheet


def size_preview(composite: Image.Image) -> Image.Image:
    sizes = (16, 24, 32, 48, 72, 192)
    scale = 4
    gap = 32
    margin = 32
    widths = [max(96, size * scale) for size in sizes]
    sheet = Image.new("RGBA", (margin * 2 + sum(widths) + gap * (len(sizes) - 1), 192 * scale + 96), (36, 43, 39, 255))
    draw = ImageDraw.Draw(sheet)
    x = margin
    for size, width in zip(sizes, widths):
        reduced = composite.resize((size, size), Image.Resampling.LANCZOS)
        enlarged = reduced.resize((size * scale, size * scale), Image.Resampling.NEAREST)
        left = x + (width - enlarged.width) // 2
        top = 56 + (192 * scale - enlarged.height) // 2
        sheet.alpha_composite(enlarged, (left, top))
        draw.text((x + width // 2, 20), f"{size}px", fill=(243, 245, 242, 255), anchor="ma")
        x += width + gap
    return sheet


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--android-res", type=Path)
    parser.add_argument("--web-icons", type=Path)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    source = Image.open(args.input).convert("RGB")
    mask = subject_mask(source)
    foreground, metrics = fit_foreground(source, mask)

    composite = Image.new("RGBA", foreground.size, BRAND_BACKGROUND)
    composite.alpha_composite(foreground)
    checker = checkerboard(FOREGROUND_CANVAS)
    checker.alpha_composite(foreground)

    foreground.save(args.output / "icon-foreground.png", optimize=True)
    composite.convert("RGB").save(args.output / "icon-composite.png", optimize=True)
    checker.convert("RGB").save(args.output / "icon-checkerboard.png", optimize=True)
    preview_sheet(composite).convert("RGB").save(args.output / "icon-mask-preview.png", optimize=True)
    size_preview(composite).convert("RGB").save(args.output / "icon-size-preview.png", optimize=True)
    (args.output / "icon-metrics.json").write_text(
        json.dumps({"input": str(args.input), **metrics}, indent=2),
        encoding="utf-8",
    )
    if args.android_res:
        write_android_resources(foreground, args.android_res)
    if args.web_icons:
        write_web_resources(foreground, args.web_icons)


if __name__ == "__main__":
    main()
