"""Pack offline OpenCV extraction output; never reads the user's original folder."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('extraction', type=Path, help='agent-browser --json output from build-fog-references-browser.js')
    args = parser.parse_args()
    raw = json.loads(args.extraction.read_text(encoding='utf-8-sig'))
    assert raw['success'], raw.get('error')
    extracted = raw['data']['result']['samples']
    assert [s['id'] for s in extracted] == [20032, 20034, 20035, 20037, 20040]
    samples = []
    for sample in extracted:
        name = 'real-20040-sparse.png' if sample['id'] == 20040 else f'real-{sample["id"]}-initial.png'
        path = ROOT/'exports/recognition-fixtures'/name
        with Image.open(path) as image:
            assert image.size == (1920, 1080)
        assert 8 <= len(sample['points']) <= 128
        assert len(sample['descriptors']) == len(sample['points'])*32
        assert all(isinstance(v, int) and 0 <= v <= 255 for v in sample['descriptors'])
        samples.append(dict(id=sample['id'], points=[[round(v, 5) for v in p] for p in sample['points']],
            descriptors=sample['descriptors'], source=dict(file=path.relative_to(ROOT).as_posix(),
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), size=[1920, 1080],
                exit=sample['exit'], entrance=sample['entrance'])))
    output = ROOT/'app/fog-references.json'
    output.write_text(json.dumps(dict(version=1, samples=samples), separators=(',', ':'))+'\n', encoding='utf8')
    print(f'Packed {len(samples)} fog references, {sum(len(s["points"]) for s in samples)} terrain descriptors, {output.stat().st_size} bytes')


if __name__ == '__main__':
    main()
