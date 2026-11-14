"""Derive sparse text/outline contrast pairs from the supplied Traditional Chinese HUD.

Run explicitly when changing the reference; normal builds use the committed JSON.
Only HUD crops are retained as test fixtures, without player names or account IDs.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ROI = (24, 235, 424, 455)


def text_pairs(image, box):
    gray = np.asarray(image.convert('L'), dtype=np.int16)
    left, top, right, bottom = box
    candidates = []
    for y in range(top, bottom):
        for x in range(left, right):
            if gray[y, x] < 215:
                continue
            patch = gray[y-2:y+3, x-2:x+3]
            dy, dx = np.unravel_index(patch.argmin(), patch.shape)
            delta = int(gray[y, x] - patch[dy, dx])
            if delta >= 70:
                candidates.append((delta, x-left, y-top, x-left+int(dx)-2, y-top+int(dy)-2))
    # Spatial coverage matters more than taking many adjacent pixels from one glyph.
    selected = []
    for _, x, y, dx, dy in sorted(candidates, reverse=True):
        if all((x-p[0])**2+(y-p[1])**2 >= 9 for p in selected):
            selected.append([x, y, dx, dy])
    selected.sort(key=lambda p: (p[0], p[1]))
    return {'width': right-left, 'height': bottom-top, 'pairs': selected}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('incomplete', type=Path)
    parser.add_argument('complete', type=Path)
    args = parser.parse_args()
    image = Image.open(args.complete).convert('RGB')
    assert image.size == (1920, 1080)
    data = {
        'language': 'zh-TW', 'referenceHeight': 1080, 'roi': list(ROI),
        'sourceSha256': hashlib.sha256(args.complete.read_bytes()).hexdigest(),
        'heading': text_pairs(image, (45, 304, 158, 330)),
        'complete': text_pairs(image, (82, 343, 271, 366)),
        'headingOffset': [-37, -39],
    }
    (ROOT/'app/evacuation-template.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf8')
    fixture = ROOT/'scripts/tests/fixtures'
    for name, source in [('incomplete', args.incomplete), ('complete', args.complete)]:
        Image.open(source).convert('RGB').crop(ROI).save(fixture/f'evacuation-{name}.jpg', quality=98)
    print({key: len(data[key]['pairs']) for key in ('heading', 'complete')})


if __name__ == '__main__':
    main()
