"""Lossless container conversion of the already licensed formal pixel font.

Run with --write once when adopting a new font, otherwise verify only. Fonts
are binary assets; fontTools is not used for application source/file editing.
"""
import argparse
import hashlib
from pathlib import Path
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[3]
source = root / "apps/web/public/fonts/fusion-pixel-12px-zh-hans.woff2"
target = root / "apps/native-android/app/src/main/res/font/fusion_pixel_12px_zh_hans.otf"
expected = "0ebd99e6f1e9b650a793a3f759c1c3dfa99f0c5b6502e78569b48ddb43767e40"
parser = argparse.ArgumentParser()
parser.add_argument("--write", action="store_true")
args = parser.parse_args()
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected, "Formal font changed; review its source and license first"
if args.write:
    target.parent.mkdir(parents=True, exist_ok=True)
    with TTFont(source, recalcTimestamp=False, recalcBBoxes=False) as font:
        font.flavor = None
        font.save(target)
with TTFont(source, recalcTimestamp=False, recalcBBoxes=False) as before, TTFont(target, recalcTimestamp=False, recalcBBoxes=False) as after:
    assert before.getGlyphOrder() == after.getGlyphOrder()
    assert before.getBestCmap() == after.getBestCmap()
    tags = set(before.keys()) - {"GlyphOrder", "head"}
    assert tags == set(after.keys()) - {"GlyphOrder", "head"}
    for tag in tags:
        assert before.getTableData(tag) == after.getTableData(tag), f"Font table changed: {tag}"
    for name in ("fontRevision", "unitsPerEm", "created", "modified", "xMin", "yMin", "xMax", "yMax", "macStyle"):
        assert getattr(before["head"], name) == getattr(after["head"], name), f"Font header changed: {name}"
    glyphs = len(after.getGlyphOrder())
license_source = root / "apps/web/public/licenses/fusion-pixel"
license_target = root / "apps/native-android/app/src/main/assets/licenses/fusion-pixel"
for entry in license_source.rglob("*"):
    if entry.is_file():
        assert entry.read_bytes() == (license_target / entry.relative_to(license_source)).read_bytes(), "Native font license missing or modified"
print(f"Verified {glyphs} glyphs, cmap, outlines, metrics, names and all four license files; OTF SHA-256 {hashlib.sha256(target.read_bytes()).hexdigest()}")
