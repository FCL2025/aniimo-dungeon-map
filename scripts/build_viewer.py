"""Build the viewer from the audited exports without reading the game again."""
import hashlib
import json
from pathlib import Path
import shutil
from app_icons import stage_app_icons
from build_routes import build as build_routes
from build_i18n import stage_i18n
from build_loot_ranking import stage_loot_ranking
from build_shop_advice import stage_shop_advice

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'exports/grab-eggs-data'
CATEGORIES = {
    'egg': '蛋巢', 'chest_gold': '金色寶箱', 'chest_glass': '琉璃寶箱',
    'stellarys_boss': '首領級幽黯星法師', 'rock_boss': '頭目級岩球郎',
    'entrance': '入口', 'exit': '出口',
    'key_orange': '橙色鑰匙標記', 'challenge': '限時挑戰',
}
# 2011 is the single-object chest in 20037's key rooms and the G6 reward.
# It shares quality 5 with gold chests, so quality alone cannot distinguish it.
CHEST_CATEGORIES = {2004: 'chest_gold', 2007: 'chest_gold',
                    2010: 'chest_gold', 2011: 'chest_glass'}
# Dungeon rooms share a 0 m origin. Chest candidates below 3 m cluster at
# ground/platform heights (0.4–2.5 m); the upper cluster begins at 3.46 m.
UPPER_FLOOR_MIN_Y = 3.0
PVP_CATEGORIES = {'cocoon': '脈源之繭', 'pvp_chest': '珍稀寶箱(金)',
                  'pvp_purple_chest': '精緻遺跡寶箱 (紫)',
                  'team_pink': '粉色集結點', 'team_yellow': '黃色集結點',
                  'team_blue': '青色集結點'}


def display_pins(pins):
    result = []
    for pin in pins:
        category = CHEST_CATEGORIES.get(pin.get('typeId')) if pin['category'] == 'chest' else pin['category']
        if category not in CATEGORIES:
            continue
        item = dict(pin, category=category)
        if pin['category'] == 'chest':
            item.update(name=CATEGORIES[category], originalName=pin['name'],
                        floor=2 if pin['world'][1] >= UPPER_FLOOR_MIN_Y else 1)
        result.append(item)
    return result


def active_map_ids(source=SOURCE):
    pool = json.loads((source / 'map-pool.json').read_text(encoding='utf8'))
    ids = sorted({mid for difficulty in ('5', '6') for mid in pool['entries'][difficulty]})
    assert ids == pool['mapIds'] and ids
    return ids


def display_icons(catalog):
    categories = {k: v for k, v in catalog['categories'].items() if k in CATEGORIES}
    for category, type_id in [('chest_gold', 2010), ('chest_glass', 2011)]:
        rewards = catalog['rewardTypes']
        categories[category] = rewards.get(str(type_id), rewards.get(type_id))
        assert categories[category] in catalog['assets']
    return dict(categories=categories, assets={k: {'image': v['image']} for k, v in catalog['assets'].items()})


def stage_pvp(output):
    source = ROOT / 'exports/pvp-map'
    record = json.loads((source / 'map.json').read_text(encoding='utf8'))
    assert record['id'] == 3004 and record['mode'] == 'pvp'
    assert set(pin['category'] for pin in record['pins']) == set(PVP_CATEGORIES)
    assert hashlib.sha256((source / record['image']).read_bytes()).hexdigest() == record['source']['imageSha256']
    (output / 'maps').mkdir(exist_ok=True)
    (output / 'icons').mkdir(exist_ok=True)
    shutil.copyfile(source / record['image'], output / 'maps/pvp-3004.png')
    assets = {}
    for name, asset in record['icons'].items():
        icon = source / asset['image']
        assert hashlib.sha256(icon.read_bytes()).hexdigest() == asset['sha256']
        shutil.copyfile(icon, output / 'icons' / name)
        assets[name] = {'image': 'icons/' + name}
    categories = {pin['category']: pin['iconKey'] for pin in record['pins']}
    pvp_maps = []
    for area in record['areas']:
        pins = [pin for pin in record['pins'] if pin['areaId'] == area['id']]
        pvp_maps.append(dict(id=area['id'], mode='pvp', mapKind='region',
                             sceneId=record['id'], names=area['names'],
                             size=record['size'], bounds=area['bounds'],
                             regionPolygon=area['polygon'], pins=pins,
                             image='maps/pvp-3004.png'))
    assert len(pvp_maps) == 6
    assert sum(len(item['pins']) for item in pvp_maps) == len(record['pins'])
    assert len({item['id'] for item in pvp_maps}) == len(pvp_maps)
    return pvp_maps, dict(categories=categories, assets=assets)


def build(source=SOURCE):
    def read(name):
        return json.loads((source / name).read_text(encoding='utf8'))
    policy = read('display-policy.json')['scope']
    maps = []
    routes = build_routes()['maps']
    for mid in active_map_ids(source):
        assert mid in policy['sceneIds']
        record = read(f'maps/{mid}.json')
        record['pins'] = display_pins(record['pins'])
        record['routes'] = routes[str(mid)]['variants']
        maps.append(record)
    difficulty = read('difficulty.json')
    pvp_maps, pvp_icons = stage_pvp(source)
    icons = display_icons(read('marker-icons.json'))
    icons['assets'].update(pvp_icons['assets'])
    data = dict(categories=CATEGORIES, pvpCategories=PVP_CATEGORIES, pvpMaps=pvp_maps,
                pvpIcons=pvp_icons, icons=icons,
                difficulties=difficulty['difficulties'], rewardRules=difficulty['rewardRules'],
                maps=maps, source=read('source.json'), validation=read('validation.json'), scope=policy)
    (source / 'data.js').write_text('window.DUNGEON_DATA=' + json.dumps(data, ensure_ascii=False,
        separators=(',', ':')).replace('</', '<\\/') + ';\n', encoding='utf8')
    for file in (ROOT / 'scripts/data_viewer').iterdir():
        if file.is_file():
            shutil.copyfile(file, source / file.name)
    stage_app_icons(source)
    stage_i18n(source)
    stage_loot_ranking(source)
    stage_shop_advice(source)
    print(f'Viewer: {len(maps)} maps, {sum(len(m["pins"]) for m in maps)} candidates')


if __name__ == '__main__':
    build()
