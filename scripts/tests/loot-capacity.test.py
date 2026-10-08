"""Regression cases for slot-limited and weight-limited pickup decisions."""
from fractions import Fraction
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from loot_capacity import capacity_metrics, cp_value, rank_items


def item(item_id, weight, price):
    return dict(id=item_id, weight=weight, sellPrice=price, stackCount=1)


class CapacityTests(unittest.TestCase):
    def test_lightweight_items_pay_for_the_whole_slot(self):
        basic = item(1, 1, 7000)
        treasure = item(2, 2, 13200)
        self.assertGreater(basic['sellPrice'] / basic['weight'], treasure['sellPrice'] / treasure['weight'])
        self.assertLess(cp_value(basic), cp_value(treasure))
        self.assertEqual(capacity_metrics(basic), dict(cpValue=7000, packCount=25, packWeight=25, packValue=175000))
        self.assertEqual(cp_value(item(3, 0.5, 7000)), cp_value(basic))

    def test_heavy_items_use_whole_units_and_leave_room_for_other_loot(self):
        diamond = capacity_metrics(item(1, 3, 34560))
        self.assertEqual(diamond, dict(cpValue=32256, packCount=23, packWeight=69, packValue=794880))
        platinum = capacity_metrics(item(2, 6, 42484))
        self.assertEqual((platinum['packCount'], platinum['packWeight'], platinum['packValue']), (11, 66, 467324))
        # CP is a smooth pickup heuristic; same-item totals also lose unused capacity.
        self.assertNotEqual(platinum['cpValue'] * 25, platinum['packValue'])

    def test_capacity_boundary_and_unpickable_item(self):
        boundary = capacity_metrics(item(1, 2.8, 10000))
        self.assertEqual(boundary, dict(cpValue=10000, packCount=25, packWeight=70, packValue=250000))
        self.assertEqual(capacity_metrics(item(2, 70, 10000))['packCount'], 1)
        self.assertEqual(capacity_metrics(item(3, 71, 10000)), dict(cpValue=0, packCount=0, packWeight=0, packValue=0))

    def test_exact_ties_and_competition_ranks(self):
        items = [item(3, 6, 20000), item(2, 3, 10000), item(1, 1, 14000), item(4, 1, 7000)]
        rank_items(items)
        self.assertEqual([(i['id'], i['rank']) for i in items], [(1, 1), (2, 2), (3, 2), (4, 4)])
        self.assertEqual(cp_value(items[1]), Fraction(28000, 3))

    def test_invalid_or_stackable_items_need_a_different_model(self):
        for invalid in [item(1, 0, 7000), item(1, -1, 7000), item(1, 1, 0), dict(item(1, 1, 7000), stackCount=2)]:
            with self.assertRaises(ValueError):
                cp_value(invalid)

    def test_committed_pickup_priorities(self):
        items = {i['id']: i for i in json.loads((ROOT / 'app/loot-ranking.json').read_text(encoding='utf8'))['items']}
        self.assertEqual(items[5000410]['rank'], 5)  # Rainbow Diamond
        self.assertEqual(items[5000220]['rank'], 7)  # Jade Ring
        self.assertEqual(items[5001002]['rank'], 17)  # Gold Essence
        self.assertEqual(items[5030202]['rank'], 23)  # Intermediate energy stones
        self.assertEqual(items[5030212]['rank'], 23)
        self.assertEqual(items[5030201]['rank'], 32)  # Basic energy stones
        self.assertEqual(items[5030211]['rank'], 32)
        self.assertEqual(items[5001001]['rank'], 34)  # Purple Essence


if __name__ == '__main__':
    unittest.main()
