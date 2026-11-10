"""Synthesize 1920x1080 initial-fog M-map views for the map pool. No game access.

Run extract_map_fog.py (game, read-only) and calibrate_fog_view.py first; their
outputs in exports/map-fog/ are committed, so this step only needs the repo.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from build_viewer import active_map_ids
from calibrate_fog_view import CAPTURES, FIXTURES
from fog_view import DATA, ROOT, SCREEN, Renderer

# Window captures with a border (1924x1082); never used for calibration, so they
# are independent checks. The game frame is the centred 1920x1080 area.
HOLDOUT = {20036: 'real-20036-initial.png', 20039: 'real-20039-initial.png'}


def capture(mid):
    if mid in CAPTURES:
        return CAPTURES[mid], False, Image.open(FIXTURES/CAPTURES[mid]).convert('RGB')
    if mid in HOLDOUT:
        image = Image.open(FIXTURES/HOLDOUT[mid]).convert('RGB')
        x, y = (image.width-SCREEN[0])//2, (image.height-SCREEN[1])//2
        return HOLDOUT[mid], True, image.crop((x, y, x+SCREEN[0], y+SCREEN[1]))
    return None, False, None


def comparison(real, synthetic, parts):
    """Real | synthetic | 4x absolute difference, cropped around the start room and side door."""
    a, b = np.asarray(real, np.int16), np.asarray(synthetic, np.int16)
    diff = Image.fromarray(np.clip(np.abs(a-b).mean(2)*4, 0, 255).astype(np.uint8)).convert('RGB')
    rows = []
    for x, y in (parts['entrance'], parts['exit']):
        box = (int(x)-160, int(y)-120, int(x)+160, int(y)+120)
        row = Image.new('RGB', (960, 240))
        for i, image in enumerate((real, synthetic, diff)):
            row.paste(image.crop(box), (i*320, 0))
        rows.append(row)
    sheet = Image.new('RGB', (960, 506), (24, 24, 28))
    for i, row in enumerate(rows):
        sheet.paste(row, (0, 26+i*240))
    ImageDraw.Draw(sheet).text((8, 6), 'real  |  synthetic  |  |difference| x4', fill=(230, 230, 230))
    return sheet


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'dist/fog-views')
    parser.add_argument('--maps', type=int, nargs='*', help='default: active map pool')
    parser.add_argument('--fixtures', action='store_true',
                        help='also store the views as exports/recognition-fixtures/synthetic-<ID>-initial.png (fog reference sources)')
    args = parser.parse_args()
    renderer = Renderer()
    ids = args.maps or active_map_ids(DATA)
    args.output.mkdir(parents=True, exist_ok=True)
    report = []
    for mid in ids:
        parts = {}
        image = renderer.render(mid, parts=parts)
        path = args.output/f'synthetic-{mid}-initial.png'
        image.save(path)
        if args.fixtures:
            image.save(FIXTURES/path.name)
        entry = dict(id=mid, file=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                     entrance=[round(v, 2) for v in parts['entrance']], exit=[round(v, 2) for v in parts['exit']])
        name, holdout, real = capture(mid)
        if real is not None:
            error = np.abs(np.asarray(real, np.float32)-np.asarray(image, np.float32)).mean(2)
            entry.update(capture=name, holdout=holdout, frameMeanAbs=round(float(error.mean()), 3))
            comparison(real, image, parts).save(args.output/f'compare-{mid}.jpg', quality=90)
        report.append(entry)
        print(entry, flush=True)
    (args.output/'report.json').write_text(json.dumps(dict(
        note='Calibration captures are in-sample here; see exports/map-fog/view-calibration.json for leave-one-out checks.',
        views=report), ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(f'{len(report)} views -> {args.output}')


if __name__ == '__main__':
    main()
