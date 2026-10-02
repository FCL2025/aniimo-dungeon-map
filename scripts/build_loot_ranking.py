"""Validate and stage the committed game-data snapshot without reading the game."""
from fractions import Fraction
import json
from pathlib import Path

from build_i18n import LOCALES

ROOT = Path(__file__).resolve().parent.parent


def stage_loot_ranking(output):
    snapshot = json.loads((ROOT / 'app/loot-ranking.json').read_text(encoding='utf-8'))
    items = snapshot['items']
    if not items or len({item['id'] for item in items}) != len(items):
        raise ValueError('Missing or duplicate loot items')
    previous, rank = None, 0
    for position, item in enumerate(items, 1):
        if item['quality'] != 5 or item['weight'] <= 0 or item['sellPrice'] <= 0:
            raise ValueError(f'Invalid gold treasure: {item["id"]}')
        if set(item['names']) != {code for code, _ in LOCALES} or not all(item['names'].values()):
            raise ValueError(f'Incomplete game translations: {item["id"]}')
        value = Fraction(item['sellPrice'], item['weight'])
        if previous is not None and value > previous:
            raise ValueError('Loot ranking is not sorted by value per weight')
        if value != previous:
            rank = position
        if item['rank'] != rank:
            raise ValueError('Loot ranking does not preserve ties')
        previous = value
    (output / 'loot-data.js').write_text('window.LOOT_RANKING=' + json.dumps(items, ensure_ascii=False,
        separators=(',', ':')).replace('</', '<\\/') + ';\n', encoding='utf-8')
