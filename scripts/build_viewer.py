"""Build the viewer from the audited exports without reading the game again."""
import json
from pathlib import Path
import shutil
from app_icons import stage_app_icons

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'exports/grab-eggs-data'
CATEGORIES = {
    'egg': '蛋巢', 'chest_gold': '金色寶箱', 'chest_glass': '琉璃寶箱',
    'stellarys_boss': '首領級幽黯星法師', 'entrance': '入口', 'exit': '出口',
    'key_orange': '橙色鑰匙標記', 'challenge': '限時挑戰',
}
# 2011 is the single-object chest in 20037's key rooms and the G6 reward.
# It shares quality 5 with gold chests, so quality alone cannot distinguish it.
CHEST_CATEGORIES = {2004: 'chest_gold', 2007: 'chest_gold',
                    2010: 'chest_gold', 2011: 'chest_glass'}


def display_pins(pins):
    result = []
    for pin in pins:
        # Chaos boss modules are present in the matching room template, while
        # the sampled scene directly references only their Nightmare variants.
        if pin['provenance'] != 'scene_reference' and not (
                pin['category'] == 'stellarys_boss'
                and pin['provenance'] == 'template_supplement'
                and pin['sandboxConfigType'] == 4):
            continue
        category = CHEST_CATEGORIES.get(pin.get('typeId')) if pin['category'] == 'chest' else pin['category']
        if category not in CATEGORIES:
            continue
        item = dict(pin, category=category)
        if pin['category'] == 'chest':
            item.update(name=CATEGORIES[category], originalName=pin['name'])
        result.append(item)
    return result


def active_map_ids(source=SOURCE):
    pool = json.loads((source / 'map-pool.json').read_text(encoding='utf8'))
    ids = sorted({mid for difficulty in ('5', '6') for mid in pool['entries'][difficulty]})
    assert ids == pool['mapIds'] and len(ids) == 7
    return ids


def display_icons(catalog):
    categories = {k: v for k, v in catalog['categories'].items() if k in CATEGORIES}
    for category, type_id in [('chest_gold', 2010), ('chest_glass', 2011)]:
        rewards = catalog['rewardTypes']
        categories[category] = rewards.get(str(type_id), rewards.get(type_id))
        assert categories[category] in catalog['assets']
    return dict(categories=categories, assets={k: {'image': v['image']} for k, v in catalog['assets'].items()})


def build(source=SOURCE):
    def read(name):
        return json.loads((source / name).read_text(encoding='utf8'))
    policy = read('display-policy.json')['scope']
    maps = []
    for mid in active_map_ids(source):
        assert mid in policy['sceneIds']
        record = read(f'maps/{mid}.json')
        record['pins'] = display_pins(record['pins'])
        maps.append(record)
    difficulty = read('difficulty.json')
    data = dict(categories=CATEGORIES, icons=display_icons(read('marker-icons.json')),
                difficulties=difficulty['difficulties'], rewardRules=difficulty['rewardRules'],
                maps=maps, source=read('source.json'), validation=read('validation.json'), scope=policy)
    (source / 'data.js').write_text('window.DUNGEON_DATA=' + json.dumps(data, ensure_ascii=False,
        separators=(',', ':')).replace('</', '<\\/') + ';\n', encoding='utf8')
    for file in (ROOT / 'scripts/data_viewer').iterdir():
        if file.is_file():
            shutil.copyfile(file, source / file.name)
    stage_app_icons(source)
    print(f'Viewer: {len(maps)} maps, {sum(len(m["pins"]) for m in maps)} candidates')


if __name__ == '__main__':
    build()
