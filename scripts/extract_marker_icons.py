"""Export the game's configured marker textures, without changing game files."""
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import UnityPy

from extract_maps import read_manifest


def export_icons(root, output, mark_categories, boss_type_id):
    marks = root['default_map_mark_data']
    rewards = {}
    evidence = {}
    for type_id, cfg in root['rob_egg_chest_data'].items():
        mark_id = cfg.get('markConfigId')
        icon = marks[mark_id]['icon'] if mark_id else cfg['icon']
        rewards[type_id] = icon.lstrip('$')
        evidence[str(type_id)] = dict(icon=icon, markConfigId=mark_id,
                                     source='default_map_mark_data.icon' if mark_id else 'rob_egg_chest_data.icon')
    mark_icons = {k: marks[k]['icon'].lstrip('$') for k in mark_categories}
    # A character portrait from the game's own iconName, not an invented boss emblem.
    boss = root['puppet_data'][boss_type_id]
    boss_icon = f'UI_PetHead_{boss["iconName"]}.png'
    categories = dict(egg=rewards[10], chest=rewards[2001], pot=rewards[1000],
                      cache=rewards[3001], stellarys_boss=boss_icon,
                      **{category: mark_icons[k] for k, category in mark_categories.items()})
    names = set(rewards.values()) | set(mark_icons.values()) | {boss_icon}
    assets, bundles, source = read_manifest()
    selected = defaultdict(list)
    for name in sorted(names):
        matches = [a for a in assets if a['path'].startswith('Assets/Res/XGUI/')
                   and Path(a['path']).name == name]
        if len(matches) != 1:
            raise ValueError(f'Expected one game icon for {name}, found {len(matches)}')
        selected[matches[0]['bundle_id']].append(matches[0])
    folder = output/'icons'
    folder.mkdir(exist_ok=True)
    records = {}
    for bundle_id, entries in selected.items():
        bundle = bundles[bundle_id]
        path = Path(bundle['file'])
        if path.stat().st_size != bundle['size']:
            raise ValueError(f'Icon bundle size mismatch: {path}')
        env = UnityPy.load(str(path))
        textures = defaultdict(list)
        for obj in env.objects:
            if obj.type.name == 'Texture2D':
                textures[obj.peek_name()].append(obj)
        for asset in entries:
            name = Path(asset['path']).name
            matches = textures[Path(name).stem]
            if len(matches) != 1:
                raise ValueError(f'Expected one texture for {name}')
            texture = matches[0].read()
            image = texture.image
            image.save(folder/name)
            records[name] = dict(image=f'icons/{name}', size=list(image.size),
                                 resourcePath=asset['path'], sourceBundle=bundle['name'],
                                 sourceBundleHash=bundle['hash'],
                                 sha256=hashlib.sha256((folder/name).read_bytes()).hexdigest())
        del env
    result = dict(source=source, assets=records, categories=categories,
                  rewardTypes=rewards, markTypes=mark_icons, rewardEvidence=evidence,
                  boss=dict(typeId=boss_type_id, iconName=boss['iconName'], icon=boss_icon,
                            usage='Game character portrait; not a verified dungeon map boss marker'),
                  note='Pot and cache configs share the generic chest icon. Original textures are not recolored.')
    (output/'marker-icons.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    return result


def viewer_icons(catalog):
    return dict(categories=catalog['categories'],
                assets={k: {'image': v['image']} for k, v in catalog['assets'].items()})
