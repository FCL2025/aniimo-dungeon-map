"""Identify the DiamondEgg showcase collectible and export original game icons.

Reads local resource version 3595896 only; never writes to or runs game files.
"""
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import zipfile

import UnityPy

from extract_maps import ROOT, read_manifest
from pmdata import DEFAULT_ARCHIVE, MEMBER, PMData, plain


OUTPUT = ROOT / 'exports/diamond-egg'


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'icons').mkdir(exist_ok=True)
    pm = PMData()
    assets, bundles, manifest = read_manifest()
    languages = {}
    members = {}
    with zipfile.ZipFile(DEFAULT_ARCHIVE) as archive:
        members[MEMBER] = sha256(archive.read(MEMBER))
        for language in ('zh_TW', 'en'):
            index_path = f'xfs/luascripts/Data/I18N/NewTextMap_{language}.json'
            blob_path = f'xfs/luascripts/Data/I18N/Compress_{language}.bin'
            index_raw, blob = archive.read(index_path), archive.read(blob_path)
            languages[language] = (json.loads(index_raw), blob)
            members[index_path], members[blob_path] = sha256(index_raw), sha256(blob)

    def loc(key, language='zh_TW'):
        index, blob = languages[language]
        entry = index.get(str(key))
        if not isinstance(entry, list):
            return str(key)
        return blob[entry[0]:entry[0] + entry[1]].decode('utf-8')

    def localized(row):
        result = {'raw': plain(row), 'text': {}}
        for field in ('name', 'itemName', 'itemDes', 'funcRep', 'desc', 'tips', 'buttonTxt'):
            if field in row:
                result['text'][field] = {lang: loc(row[field], lang) for lang in languages}
        return result

    showcase = pm.root['egg_book_Collection_data']
    slot = showcase[100101]
    assert slot['listImage'] == '$ui_item_GrabEgg_Collection_Icon_DiamondEgg.png'
    assert set(slot['itemId'].values()) == {5901301, 5900509}
    ids = [5001301, 5901301, 5000509, 5900509]
    selected_tables = {
        'egg_book_Collection_data': {k: localized(v) for k, v in showcase.items()},
        'egg_book_antique_data': {k: plain(pm.root['egg_book_antique_data'][k])
                                  for k in (5901301, 5900509)},
        'item_data': {k: localized(pm.root['item_data'][k]) for k in ids},
        'collect_item_data': {k: localized(pm.root['collect_item_data'][k])
                              for k in (5001301, 5000509)},
        'rob_egg_item_in': {k: plain(pm.root['rob_egg_item_in'][k])
                            for k in (5001301, 5000509)},
        'rob_egg_item_out': {k: plain(pm.root['rob_egg_item_out'][k])
                             for k in (5901301, 5900509)},
        'item_source_data': {717: localized(pm.root['item_source_data'][717])},
        'rob_egg_collection_variant_model_data': {
            k: plain(pm.root['rob_egg_collection_variant_model_data'][k]) for k in (1, 2, 3)
        },
        'rob_egg_collection_calcine_data': {
            k: plain(v) for k, v in pm.root['rob_egg_collection_calcine_data'].items()
            if v.get('effectBindKey') == 'DiamondEgg'
        },
    }
    for inside, outside in ((5001301, 5901301), (5000509, 5900509)):
        assert pm.root['rob_egg_item_in'][inside]['outid'] == outside
        assert pm.root['rob_egg_item_out'][outside]['inid'] == inside
        assert pm.root['egg_book_antique_data'][outside]['pos'] == 100101

    related_assets = [a for a in assets if 'diamondegg' in a['path'].lower()]
    icon_assets = [a for a in related_assets if a['path'].endswith('.png')]
    grouped = defaultdict(list)
    for asset in icon_assets:
        grouped[asset['bundle_id']].append(asset)
    exported = []
    for bundle_id, entries in sorted(grouped.items()):
        bundle = bundles[bundle_id]
        source = Path(bundle['file'])
        if source.stat().st_size != bundle['size']:
            raise ValueError(f'Bundle size mismatch: {source}')
        print(f"Reading bundle {bundle_id}: {len(entries)} icons", flush=True)
        env = UnityPy.load(str(source))
        textures = defaultdict(list)
        for obj in env.objects:
            if obj.type.name == 'Texture2D':
                textures[obj.peek_name()].append(obj)
        for asset in entries:
            name = Path(asset['path']).name
            candidates = textures[Path(name).stem]
            if len(candidates) != 1:
                raise ValueError(f'Expected one texture for {name}: {len(candidates)}')
            obj = candidates[0]
            texture = obj.read()
            image = texture.image
            target = OUTPUT / 'icons' / name
            image.save(target)
            exported.append(dict(resourcePath=asset['path'],
                                 output=f'icons/{name}', size=list(image.size),
                                 objectType=obj.type.name, pathId=obj.path_id,
                                 textureFormat=texture.m_TextureFormat,
                                 sourceBundle=bundle, sha256=sha256(target.read_bytes())))
        del env

    evidence = dict(
        createdAt=datetime.now(timezone.utc).isoformat(),
        source=dict(manifest=manifest, archive=DEFAULT_ARCHIVE, memberSha256=members),
        toolVersions={'UnityPy': UnityPy.__version__},
        conclusion=dict(name=loc(slot['name']), nameEn=loc(slot['name'], 'en'),
                        showcaseSlot=100101, normalIds=[5001301, 5901301],
                        collectorIds=[5000509, 5900509],
                        unknownName=loc(2100954001), unknownDescription=loc(1850508929),
                        lockModel=slot['lockModel'],
                        limitations='Locked screenshot does not distinguish normal/collector variants. '
                        'No exact spawn location or final drop probability established.'),
        tables=selected_tables,
        icons=exported,
        assets=[dict(**a, sourceBundle=bundles[a['bundle_id']]) for a in related_assets],
    )
    (OUTPUT / 'evidence.json').write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Exported {len(exported)} original icons; {len(related_assets)} asset references.')
    print(OUTPUT)


if __name__ == '__main__':
    main()
