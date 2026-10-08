"""Capacity-aware pickup priority, assuming one unstackable item per slot.

CP values one item against the larger of its slot and weight budget shares.
It is a static pickup heuristic, not a mixed-inventory knapsack solver or an
expected return estimate. Same-item packing uses whole items and is separate.
"""
from fractions import Fraction

BACKPACK = dict(slots=25, maxWeight=70, slotsPerItem=1)
RANKING_FORMULA = 'sellPrice / max(1, weight * 25 / 70)'


def cp_value(item):
    weight = Fraction(str(item['weight']))
    if weight <= 0 or item['sellPrice'] <= 0 or item['stackCount'] != 1:
        raise ValueError(f'Invalid capacity inputs: {item["id"]}')
    if weight > BACKPACK['maxWeight']:
        return Fraction(0)
    cost = max(Fraction(1), weight * BACKPACK['slots'] / BACKPACK['maxWeight'])
    return Fraction(item['sellPrice']) / cost


def capacity_metrics(item):
    score = cp_value(item)
    count = min(BACKPACK['slots'], int(Fraction(BACKPACK['maxWeight']) / Fraction(str(item['weight']))))
    return dict(cpValue=float(score), packCount=count,
                packWeight=item['weight'] * count, packValue=item['sellPrice'] * count)


def rank_items(items):
    items.sort(key=lambda item: (-cp_value(item), item['id']))
    previous, rank = None, 0
    for position, item in enumerate(items, 1):
        value = cp_value(item)
        if value != previous:
            rank = position
        item.update(rank=rank, **capacity_metrics(item))
        previous = value
