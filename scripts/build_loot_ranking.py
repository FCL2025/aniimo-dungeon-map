"""Validate and stage the committed game-data snapshot without reading the game."""
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import shutil

from build_i18n import LOCALES

ROOT = Path(__file__).resolve().parent.parent


def stage_loot_ranking(output):
    snapshot = json.loads((ROOT / 'app/loot-ranking.json').read_text(encoding='utf-8'))
    items = snapshot['items']
    icons = json.loads((ROOT / 'app/loot-icons/manifest.json').read_text(encoding='utf-8'))['assets']
    ids = {item['id'] for item in items}
    if not items or len(ids) != len(items):
        raise ValueError('Missing or duplicate loot items')
    source = snapshot['source']
    if (source['purpleValueThresholdExclusive'] != 7000
            or set(source['keyItemIds']) != {5001102, 5001103}
            or set(source['excludedItemTypes']) != {10, 14, 15, 16}):
        raise ValueError('Unexpected loot ranking scope')
    if (not set(source['keyItemIds']).issubset(ids)
            or not set(source['extraGoldItemIds']).issubset(ids)
            or not set(source['purpleItemIds']).issubset(ids)):
        raise ValueError('Missing keys or ranked gold/purple items')
    previous, rank = None, 0
    for position, item in enumerate(items, 1):
        if item['quality'] not in (4, 5) or item['weight'] <= 0 or item['sellPrice'] <= 0:
            raise ValueError(f'Invalid ranked item: {item["id"]}')
        if item['itemType'] in source['excludedItemTypes']:
            raise ValueError(f'Excluded equipment or chip in ranking: {item["id"]}')
        if item['id'] in source['extraGoldItemIds'] and item['quality'] != 5:
            raise ValueError(f'Extra gold item changed quality: {item["id"]}')
        if set(item['names']) != {code for code, _ in LOCALES} or not all(item['names'].values()):
            raise ValueError(f'Incomplete game translations: {item["id"]}')
        value = Fraction(item['sellPrice'], item['weight'])
        if item['quality'] == 4 and (item['id'] not in source['purpleItemIds'] or value <= 7000):
            raise ValueError(f'Purple item does not meet threshold: {item["id"]}')
        if previous is not None and value > previous:
            raise ValueError('Loot ranking is not sorted by value per weight')
        if value != previous:
            rank = position
        if item['rank'] != rank:
            raise ValueError('Loot ranking does not preserve ties')
        icon = item.get('icon', '')
        if icon not in icons or Path(icon).parts != ('loot-icons', Path(icon).name):
            raise ValueError(f'Missing or invalid game icon: {item["id"]}')
        if hashlib.sha256((ROOT / 'app' / icon).read_bytes()).hexdigest() != icons[icon]['sha256']:
            raise ValueError(f'Game icon checksum mismatch: {icon}')
        previous = value
    (output / 'loot-icons').mkdir(exist_ok=True)
    for icon in sorted({item['icon'] for item in items}):
        shutil.copyfile(ROOT / 'app' / icon, output / icon)
    (output / 'loot-data.js').write_text('window.LOOT_RANKING=' + json.dumps(items, ensure_ascii=False,
        separators=(',', ':')).replace('</', '<\\/') + ';\n', encoding='utf-8')
