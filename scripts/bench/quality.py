#!/usr/bin/env python3
"""Reads bench.json from compress.mjs and reports size savings, visual similarity (SSIM of
pages rendered at 72 dpi, worst page) and whether extracted text is unchanged.
Requires: poppler-utils (pdftoppm, pdftotext), numpy, pillow, scikit-image.
Usage: python3 scripts/bench/quality.py <folder>"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim

folder = sys.argv[1]
os.chdir(folder)
rows = json.load(open('bench.json'))

def render(pdf, tag):
    subprocess.run(['pdftoppm', '-r', '72', '-png', pdf, tag], check=True)
    return sorted(x for x in os.listdir('.') if x.startswith(tag + '-'))

def text(pdf):
    return subprocess.run(['pdftotext', pdf, '-'], capture_output=True, text=True).stdout

print(f"{'file':26} {'level':9} {'before':>10} {'after':>10} {'saved':>7} {'ms':>6} {'SSIM':>6} text  img rec/down/skip")
for r in rows:
    src, out = r['f'], f"out-{r['level']}-{r['f']}"
    a, b = render(src, 'qa'), render(out, 'qb')
    s = [ssim(np.asarray(Image.open(x).convert('L')), np.asarray(Image.open(y).convert('L'))) for x, y in zip(a, b)]
    for x in a + b:
        os.remove(x)
    i = r['img']
    print(f"{r['f']:26} {r['level']:9} {r['before']:>10,} {r['after']:>10,} {100 * (1 - r['after'] / r['before']):>6.1f}% "
          f"{r['ms']:>6} {min(s):>6.3f} {'same' if text(src) == text(out) else 'DIFF':5} {i['recompressed']}/{i['downsampled']}/{i['skipped']}")
