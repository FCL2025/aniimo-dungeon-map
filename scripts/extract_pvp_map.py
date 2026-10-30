"""Export the PvP island, referenced dungeon images, and verified static marks."""
import hashlib
import json
import zipfile
from pathlib import Path

import UnityPy
from PIL import Image

from extract_maps import read_manifest
from pmdata import PMData, plain
from parse_dungeon_data import world_to_pixel, calibration

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r'F:\Pawprint\Aniimo\game')
ARCHIVE = GAME / 'Aniimo_Data/cvs/res/lua/LuaScripts.xdf'
OUTPUT = ROOT / 'exports/pvp-map'
TYPES = {1010: 'cocoon', 1013: 'pvp_chest', 1023: 'team_pink',
         1024: 'team_yellow', 1025: 'team_blue'}


def export_submaps(root, assets, bundles):
    born = root['rob_egg_born_data'][3004]
    pool_groups = {}
    for group, entries in born['DungeonList'].items():
        for mid in entries.values():
            pool_groups.setdefault(int(mid), set()).add(int(group))
    for mid in born['list'].values():
        pool_groups.setdefault(int(mid), set())
    by_group = {}
    for asset in assets:
        relative = asset['path'].split('/Texture/', 1)
        if len(relative) != 2:
            continue
        group = relative[1].split('/', 1)[0]
        if group.isdecimal() and int(group) in pool_groups:
            by_group.setdefault(int(group), []).append(asset)
    missing = sorted(set(pool_groups) - set(by_group))
    selected = sorted(by_group)
    if not selected:
        raise ValueError('No PvP dungeon textures found')
    bundle_ids = {asset['bundle_id'] for mid in selected for asset in by_group[mid]}
    texture_objects = {}
    for bundle_id in sorted(bundle_ids):
        env = UnityPy.load(bundles[bundle_id]['file'])
        texture_objects[bundle_id] = {obj.peek_name(): obj for obj in env.objects
                                      if obj.type.name == 'Texture2D'}
    map_dir = OUTPUT / 'maps'
    map_dir.mkdir(exist_ok=True)
    records = []
    for mid in selected:
        tiles = by_group[mid]
        if len(tiles) != 64:
            raise ValueError(f'Unexpected {mid} tile count: {len(tiles)}')
        canvas = Image.new('RGBA', (2048, 2048))
        positions = set()
        for asset in tiles:
            name = Path(asset['path']).stem
            x, y = (int(value) for value in name.rsplit('_', 2)[-2:])
            if (x, y) in positions or name not in texture_objects[asset['bundle_id']]:
                raise ValueError(f'Invalid dungeon tile: {name}')
            positions.add((x, y))
            canvas.paste(texture_objects[asset['bundle_id']][name].read().image.convert('RGBA'),
                         (x * 256, y * 256))
        if positions != {(x, y) for x in range(8) for y in range(8)}:
            raise ValueError(f'Incomplete dungeon tile grid: {mid}')
        image = map_dir / f'{mid}.png'
        canvas.save(image)
        content_bounds = canvas.getchannel('A').getbbox()
        if not content_bounds:
            raise ValueError(f'Empty dungeon map: {mid}')
        records.append(dict(id=mid, mode='pvp', mapKind='dungeon',
                            image=f'maps/{mid}.png', size=[2048, 2048],
                            bounds=list(content_bounds), pins=[],
                            poolGroups=sorted(pool_groups[mid]),
                            imageSha256=hashlib.sha256(image.read_bytes()).hexdigest()))
        print(f'PvP dungeon {mid}: 64 tiles', flush=True)
    return records, missing


def main():
    root = PMData(ARCHIVE).root
    scene = root['scene_data'][3004]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    version = (GAME / 'verlist.txt').read_text(encoding='utf8').split(',', 1)[0]
    assets, bundles, meta = read_manifest(GAME, version)
    tile_assets = [a for a in assets if '/Texture/3004/' in a['path']]
    width, height = (scene['mapUISize'][i] for i in (1, 2))
    if len(tile_assets) != width * height // (256 * 256) or len({a['bundle_id'] for a in tile_assets}) != 1:
        raise ValueError('Unexpected PvP island tile layout')
    tile_bundle = bundles[tile_assets[0]['bundle_id']]
    env = UnityPy.load(tile_bundle['file'])
    textures = {obj.peek_name(): obj for obj in env.objects if obj.type.name == 'Texture2D'}
    canvas = Image.new('RGBA', (width, height))
    positions = set()
    for asset in tile_assets:
        name = Path(asset['path']).stem
        x, y = (int(value) for value in name.rsplit('_', 2)[-2:])
        if (x, y) in positions or name not in textures:
            raise ValueError(f'Invalid island tile: {name}')
        positions.add((x, y))
        canvas.paste(textures[name].read().image.convert('RGBA'), (x * 256, y * 256))
    if positions != {(x, y) for x in range(width // 256) for y in range(height // 256)}:
        raise ValueError('Incomplete island tile grid')
    canvas.save(OUTPUT / '3004.png')
    marks = root['Scene.3004.scene_mark_point_data']
    configs = root['default_map_mark_data']
    cal = calibration(scene)
    pins = []
    for mid, mark in marks.items():
        type_id = mark['markConfigId']
        if type_id not in TYPES:
            continue
        world = [mark['markPosition'][i] for i in (1, 2, 3)]
        pixel = world_to_pixel(world, cal)
        if not (0 <= pixel[0] <= width and 0 <= pixel[1] <= height):
            raise ValueError(f'Marker {mid} outside island map: {pixel}')
        icon = configs[type_id]['icon'].lstrip('$')
        pins.append(dict(id=mid, category=TYPES[type_id], iconKey=icon,
                         typeId=type_id, areaId=mark.get('largeAreaId'),
                         world=world, pixel=pixel, provenance='scene_reference'))
    # These chests have no map-mark entry, but their scene entities have fixed
    # positions. Keep them distinct from the gold map-mark chests.
    for mid, entity in root['Scene.3004.scene_entity_data'].items():
        if entity.get('subType') != 'ResourceBox' or entity.get('idInType') != 2009:
            continue
        world = [entity['position'][i] for i in (1, 2, 3)]
        pins.append(dict(id=mid, category='pvp_purple_chest',
                         iconKey='UI_Icon_MarkPoint_Chest.png', typeId=2009,
                         areaId=entity['largeAreaId'], world=world,
                         pixel=world_to_pixel(world, cal), provenance='scene_entity'))
    locales = {'de': 'de_DE', 'en': 'en', 'es': 'es_ES', 'fr': 'fr_FR',
               'id': 'id_ID', 'ja': 'ja', 'ko': 'ko', 'pt': 'pt_PT',
               'ru': 'ru_RU', 'th': 'th_TH', 'vi': 'vi_VN',
               'zh-CN': 'zh_CN', 'zh-TW': 'zh_TW'}
    with zipfile.ZipFile(ARCHIVE) as archive:
        texts = {}
        for locale, source_locale in locales.items():
            base = f'xfs/luascripts/Data/I18N/'
            index = json.loads(archive.read(base + f'NewTextMap_{source_locale}.json'))
            blob = archive.read(base + f'Compress_{source_locale}.bin')
            texts[locale] = (index, blob)
    areas = []
    for area_id in range(41003, 41009):
        block = root['map_block_pos_data'][area_id]
        assert block['sceneId'] == 3004
        polygon = [world_to_pixel([point[1], 0, point[3]], cal)
                   for point in block['posList'].values()]
        xs, ys = zip(*polygon)
        name_id = root['map_block_config_data'][area_id]['areaName']
        names = {}
        for locale, (index, blob) in texts.items():
            start, length = index[str(name_id)]
            names[locale] = blob[start:start + length].decode('utf8')
        areas.append(dict(id=area_id, names=names, polygon=polygon,
                          bounds=[max(0, int(min(xs) - 80)), max(0, int(min(ys) - 80)),
                                  min(width, int(max(xs) + 80)),
                                  min(height, int(max(ys) + 80))]))
    icon_names = sorted({p['iconKey'] for p in pins})
    selected = {}
    for name in icon_names:
        matches = [a for a in assets if a['path'].startswith('Assets/Res/XGUI/')
                   and Path(a['path']).name == name]
        if len(matches) != 1:
            raise ValueError(f'Expected one asset for {name}: {len(matches)}')
        selected[name] = matches[0]
    icon_dir = OUTPUT / 'icons'
    icon_dir.mkdir(exist_ok=True)
    for name, asset in selected.items():
        bundle = bundles[asset['bundle_id']]
        env = UnityPy.load(bundle['file'])
        matches = [obj for obj in env.objects if obj.type.name == 'Texture2D'
                   and obj.peek_name() == Path(name).stem]
        if len(matches) != 1:
            raise ValueError(f'Expected one texture for {name}: {len(matches)}')
        matches[0].read().image.save(icon_dir / name)
    submaps, missing = export_submaps(root, assets, bundles)
    catalog = dict(id=3004, mode='pvp', image='3004.png', size=[width, height],
                   bounds=[0, 0, width, height], pins=pins,
                   areas=areas, submaps=submaps, missingDungeonImages=missing,
                   icons={name: dict(image='icons/' + name,
                                     sha256=hashlib.sha256((icon_dir / name).read_bytes()).hexdigest())
                          for name in icon_names},
                   source=dict(resourceVersion=version, sceneId=3004,
                               markTable='Scene.3004.scene_mark_point_data',
                               markTypes=sorted(TYPES), manifestSha256=meta['sha256'],
                               imageSource='Current game manifest Texture/3004 tiles',
                               imageSha256=hashlib.sha256((OUTPUT / '3004.png').read_bytes()).hexdigest()))
    (OUTPUT / 'map.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf8')
    print(f'PvP island: {len(pins)} configured markers, {len(icon_names)} icons')


if __name__ == '__main__':
    main()
