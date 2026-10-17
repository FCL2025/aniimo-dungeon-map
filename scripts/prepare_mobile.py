"""Stage only audited, offline map assets for the independent Android app."""
import hashlib
import json
import shutil
from pathlib import Path
from analyze_portal_geometry import portal_geometry
from build_viewer import CATEGORIES, active_map_ids, display_pins, display_icons

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'exports/grab-eggs-data'
OUTPUT = ROOT / 'mobile/android/app/src/main/assets/generated'


def prepare():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    scenes = json.loads((SOURCE / 'source-tables.json').read_text(encoding='utf8'))['scenes']
    catalog = json.loads((SOURCE / 'marker-icons.json').read_text(encoding='utf8'))
    policy = json.loads((SOURCE / 'display-policy.json').read_text(encoding='utf8'))['scope']
    assert policy['kind'] == 'dungeon' and policy['loadLayerTextures'] is False
    records, expected = [], set()
    def copy(source, relative):
        target = (OUTPUT / relative).resolve()
        assert target.is_relative_to(OUTPUT.resolve())
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        expected.add(relative)
    for mid in active_map_ids(SOURCE):
        assert mid in policy['sceneIds']
        original = json.loads((SOURCE / 'maps' / f'{mid}.json').read_text(encoding='utf8'))
        record = {key: original[key] for key in ('id', 'size', 'bounds')}
        record['image'] = f'maps/{mid}.png'
        record['portalGeometry'] = portal_geometry(original, scenes[str(mid)]['mapImageScale'])
        fields = ('id', 'category', 'iconKey', 'difficultyCandidates', 'pixel', 'provenance', 'floor')
        record['pins'] = [{key: pin[key] for key in fields if key in pin} for pin in display_pins(original['pins'])]
        records.append(record)
        copy(ROOT / f'exports/grab-eggs-dungeons/preview/UI_Img_Map_{mid}.png', record['image'])
    for asset in catalog['assets'].values():
        source = SOURCE / asset['image']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == asset['sha256']
        copy(source, asset['image'])
    data = dict(maps=records, categories=CATEGORIES, icons=display_icons(catalog))
    (OUTPUT / 'maps.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    expected.add('maps.json')
    # Reject unexpected packaged assets rather than silently shipping old desktop workers.
    actual = {p.relative_to(OUTPUT).as_posix() for p in OUTPUT.rglob('*') if p.is_file()}
    if actual != expected:
        raise ValueError(f'Unexpected mobile assets: {sorted(actual - expected)}')
    icons = ROOT / 'mobile/android/app/src/main/res/drawable-nodpi'
    icons.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'app/src-tauri/icons/icon.png', icons / 'generated_app_icon.png')
    shutil.copyfile(SOURCE / 'icons/Img_Map_Mark_GrabEgg_Lair.png', icons / 'generated_egg.png')
    print(f'Android: {len(records)} maps, {sum(len(m["pins"]) for m in records)} candidates, {len(expected)} asset files; no capture/tracking assets.')


if __name__ == '__main__':
    prepare()
