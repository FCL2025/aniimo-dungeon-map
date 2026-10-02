"""Extract the ranked items' original game textures; never modify game files."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import UnityPy

from extract_maps import GAME, read_manifest
from pmdata import DEFAULT_ARCHIVE, MEMBER, PMData

ROOT = Path(__file__).resolve().parent.parent


def extract(snapshot_path, game=GAME, version=None, archive=DEFAULT_ARCHIVE):
    output = snapshot_path.parent / 'loot-icons'
    if output.resolve().is_relative_to(game.resolve()):
        raise ValueError('Icon output must be outside the game directory')
    if version is None:
        version = (game / 'Aniimo_Data/cvs/res/uab/win/DefaultPackage/ManifestFiles/'
                   'PackageManifest_DefaultPackage.version').read_text(encoding='utf-8').strip()
    assets, bundles, manifest = read_manifest(game, version)
    snapshot = json.loads(snapshot_path.read_text(encoding='utf-8'))
    pm = PMData(archive)
    names = set()
    for item in snapshot['items']:
        row = pm.root['item_data'][item['id']]
        if any(row[key] != item[key] for key in ('weight', 'sellPrice', 'quality')) or row['itemName'] != item['nameKey']:
            raise ValueError(f'Game data changed for {item["id"]}; refresh the ranking snapshot first')
        name = row['icon'].lstrip('$')
        if Path(name).name != name or Path(name).suffix != '.png':
            raise ValueError(f'Unexpected icon reference: {name}')
        item['icon'] = f'loot-icons/{name}'
        names.add(name)
    grouped = defaultdict(list)
    for name in sorted(names):
        matches = [asset for asset in assets if asset['path'].startswith('Assets/Res/XGUI/')
                   and Path(asset['path']).name == name]
        if len(matches) != 1:
            raise ValueError(f'Expected one asset for {name}, found {len(matches)}')
        grouped[matches[0]['bundle_id']].append(matches[0])
    output.mkdir(parents=True, exist_ok=True)
    records = {}
    for bundle_id, entries in grouped.items():
        bundle = bundles[bundle_id]
        bundle_path = Path(bundle['file'])
        if bundle_path.stat().st_size != bundle['size']:
            raise ValueError(f'Bundle size mismatch: {bundle_path}')
        print(f'Extracting {len(entries)} loot icons from bundle {bundle_id}', flush=True)
        env = UnityPy.load(str(bundle_path))
        textures = defaultdict(list)
        for obj in env.objects:
            if obj.type.name == 'Texture2D':
                textures[obj.peek_name()].append(obj)
        for asset in entries:
            name = Path(asset['path']).name
            matches = textures[Path(name).stem]
            if len(matches) != 1:
                raise ValueError(f'Expected one texture for {name}, found {len(matches)}')
            image = matches[0].read().image
            target = output / name
            image.save(target)
            records[f'loot-icons/{name}'] = dict(resourcePath=asset['path'], size=list(image.size),
                sourceBundle=bundle['name'], sourceBundleHash=bundle['hash'],
                sha256=hashlib.sha256(target.read_bytes()).hexdigest())
        del env
    catalog = dict(source=dict(version=version, manifestSha256=manifest['sha256'],
                               table=MEMBER, tableSha256=hashlib.sha256(pm.data).hexdigest()),
                   assets=records)
    (output / 'manifest.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Exported {len(records)} original game icons')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, default=ROOT / 'app/loot-ranking.json')
    parser.add_argument('--game', type=Path, default=GAME)
    parser.add_argument('--version', help='Defaults to the installed game manifest version')
    parser.add_argument('--archive', default=DEFAULT_ARCHIVE)
    args = parser.parse_args()
    extract(args.snapshot, args.game, args.version, args.archive)
