"""Pack start-room fog references extracted from synthesized initial views.

Input is the JSON written by scripts/build_fog_references.cjs. Source views are
exports/recognition-fixtures/synthetic-<ID>-initial.png from build_fog_views.py;
no game capture or user folder is read.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

from build_viewer import active_map_ids

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('extraction', type=Path, nargs='?', default=ROOT/'dist/fog-reference/extracted.json')
    args = parser.parse_args()
    raw = json.loads(args.extraction.read_text(encoding='utf-8-sig'))
    assert raw['success'], raw.get('error')
    extracted = raw['data']['result']['samples']
    assert [s['id'] for s in extracted] == active_map_ids(ROOT/'exports/grab-eggs-data'), 'every supported dungeon needs a reference'
    fog = ROOT/'exports/map-fog'
    generator = dict(source=hashlib.sha256((fog/'source.json').read_bytes()).hexdigest(),
                     calibration=hashlib.sha256((fog/'view-calibration.json').read_bytes()).hexdigest(),
                     resourceVersion=json.loads((fog/'source.json').read_text(encoding='utf8'))['source']['manifest']['version'])
    samples = []
    for sample in extracted:
        path = ROOT/'exports/recognition-fixtures'/f'synthetic-{sample["id"]}-initial.png'
        with Image.open(path) as image:
            assert sample['size'] == list(image.size) == [1920, 1080]
        assert 8 <= len(sample['points']) <= 128
        assert len(sample['descriptors']) == len(sample['points'])*32
        assert all(isinstance(v, int) and 0 <= v <= 255 for v in sample['descriptors'])
        samples.append(dict(id=sample['id'], points=[[round(v, 5) for v in p] for p in sample['points']],
            descriptors=sample['descriptors'], source=dict(file=path.relative_to(ROOT).as_posix(),
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), size=sample['size'],
                exit=[round(v, 2) for v in sample['exit']], entrance=[round(v, 2) for v in sample['entrance']])))
    output = ROOT/'app/fog-references.json'
    output.write_text(json.dumps(dict(version=1, generator=generator, samples=samples), separators=(',', ':'))+'\n', encoding='utf8')
    print(f'Packed {len(samples)} fog references, {sum(len(s["points"]) for s in samples)} terrain descriptors, {output.stat().st_size} bytes')


if __name__ == '__main__':
    main()
