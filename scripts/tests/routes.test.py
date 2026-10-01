"""Check navigable geometry, independent chest stops and detour budgets."""
import itertools
import json
import math
from pathlib import Path
import sys
import unittest

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_routes import Floor, MAP_IDS, ROOT, paired_masks, prepare_plan, shortest_tours


class RouteTests(unittest.TestCase):
    def test_subset_optimum_matches_exhaustive_chest_orders(self):
        points = [(0, 0), (2, 3), (8, 4), (10, 9), (1, 5), (20, 20), (9, 0)]
        matrix = [[math.dist(a, b) for b in points] for a in points]
        tours = shortest_tours(matrix, 5)
        exhaustive = min(sum(matrix[a][b] for a, b in zip([0, *order], [*order, 6]))
                         for order in itertools.permutations(range(1, 6), 4))
        self.assertAlmostEqual(tours[4][0], exhaustive)

    def test_returning_to_either_start_matches_exhaustive_orders(self):
        chests = [(2, 3), (8, 4), (10, 9), (1, 5), (20, 20)]
        for start, end in itertools.product([(0, 0), (9, 0)], repeat=2):
            with self.subTest(start=start, end=end):
                points = [start, *chests, end]
                matrix = [[math.dist(a, b) for b in points] for a in points]
                tours = shortest_tours(matrix, len(chests))
                for count in (4, 5):
                    exhaustive = min(sum(matrix[a][b] for a, b in zip([0, *order], [*order, 6]))
                                     for order in itertools.permutations(range(1, 6), count))
                    self.assertAlmostEqual(tours[count][0], exhaustive)

    def test_exact_assigned_subsets_match_exhaustive_orders(self):
        points = [(0, 0), (2, 3), (8, 4), (10, 9), (1, 5), (20, 20), (9, 0)]
        matrix = [[math.dist(a, b) for b in points] for a in points]
        for mask, (distance, order) in shortest_tours(matrix, 5, by_mask=True).items():
            stops = [i+1 for i in range(5) if mask & (1 << i)]
            exhaustive = min(sum(matrix[a][b] for a, b in zip([0, *p], [*p, 6]))
                             for p in itertools.permutations(stops))
            self.assertAlmostEqual(distance, exhaustive)
            self.assertEqual(set(order[1:-1]), set(stops))

    def test_pair_rebalances_scarce_chests_without_sharing(self):
        for count, expected in [(6, (3, 3)), (7, (4, 3)), (9, (4, 4))]:
            with self.subTest(count=count):
                subsets = {mask: (mask.bit_count()+mask/1000, []) for mask in range(1, 1 << count)}
                a, b = paired_masks(subsets, 0b1111, count)
                self.assertEqual((a.bit_count(), b.bit_count()), expected)
                self.assertEqual(a & b, 0)
                self.assertEqual(a & 0b1111, a)
                feasible = [(x, y) for x in subsets for y in subsets
                            if x.bit_count() == expected[0] and y.bit_count() == expected[1]
                            and x & 0b1111 == x and not x & y]
                score = lambda pair: (max(subsets[m][0] for m in pair), sum(subsets[m][0] for m in pair))
                self.assertEqual(score((a, b)), min(map(score, feasible)))

    def test_walls_and_diagonal_corners_are_not_shortcuts(self):
        image = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 55, 127), fill=(180, 180, 180, 255))
        draw.rectangle((72, 0, 127, 127), fill=(180, 180, 180, 255))
        floor = Floor(image)
        left, right = floor.snap([20, 20]), floor.snap([100, 20])
        self.assertNotIn(right, floor.distances(left)[0])
        image = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 7, 7), fill='white')
        draw.rectangle((8, 8, 15, 15), fill='white')
        floor = Floor(image)
        self.assertNotIn(floor.snap([12, 12]), floor.distances(floor.snap([4, 4]))[0])

    def test_all_seven_routes_and_optional_key_rooms(self):
        data = json.loads((ROOT/'app/routes.json').read_text(encoding='utf8'))
        self.assertEqual(data['version'], 3)
        self.assertEqual(sorted(map(int, data['maps'])), list(MAP_IDS))
        for mid in MAP_IDS:
            record = json.loads((ROOT/f'exports/grab-eggs-data/maps/{mid}.json').read_text(encoding='utf8'))
            pins = {p['id']: p for p in record['pins']}
            locked_rooms = {p['roomId'] for p in pins.values() if p['category'] == 'key_orange'}
            floor = Floor(Image.open(ROOT/f'exports/grab-eggs-dungeons/preview/UI_Img_Map_{mid}.png'))
            floor.add_stair_links(record)
            for name, family in data['maps'][str(mid)]['variants'].items():
                self.assertEqual(set(family['selections']), {'auto', 'entrance', 'exit'})
                prepared = {key: prepare_plan(record, floor, name == 'supplements', *key.split('-'))
                            for key in ['entrance-entrance', 'entrance-exit', 'exit-entrance', 'exit-exit']}
                for start, pair in family['selections'].items():
                    self.assertEqual(set(pair), {'1', '2'})
                    for number, route in pair.items():
                        with self.subTest(map=mid, variant=name, start=start, route=number):
                            self.assertEqual(route['routeNumber'], int(number))
                            if start != 'auto':
                                self.assertEqual(route['start'], start)
                            self.check_route(route, pins, locked_rooms, floor, name, record)
                            self.assertGreaterEqual(route['chestCount'], min(4, family['reachableChestCount']//2))
                            # Independently solve only this player's reserved rooms.
                            assigned = {s['pinId'] for s in route['stops'][1:-1]}
                            best = math.inf
                            for value in prepared.values():
                                if start != 'auto' and value['start'] != start:
                                    continue
                                keep = [0, *[i for i, p in enumerate(value['checkpoints']) if p['id'] in assigned], len(value['checkpoints'])-1]
                                matrix = [[value['matrix'][i][j] for j in keep] for i in keep]
                                best = min(best, shortest_tours(matrix, len(assigned))[len(assigned)][0])
                            self.assertAlmostEqual(route['distancePixels'], best, delta=.01)
                # Different starting portals must still have disjoint ownership.
                for first, second in itertools.product(family['selections'].values(), repeat=2):
                    a, b = first['1'], second['2']
                    self.assertFalse(self.rooms(a) & self.rooms(b))
                    self.assertLessEqual(abs(a['chestCount']-b['chestCount']), 1)
                    self.assertLessEqual(abs(len(self.rooms(a))-len(self.rooms(b))), 1)
                    self.assertLessEqual(abs(bool(a['optionalDoor'])-bool(b['optionalDoor'])), 1)
                for number in ('1', '2'):
                    self.assertTrue(all(self.rooms(pair[number]) == self.rooms(family['selections']['auto'][number])
                                        for pair in family['selections'].values()))

    @staticmethod
    def rooms(route):
        return {s['roomId'] for s in route['stops'][1:-1]} | ({route['optionalDoor']['roomId']} if route['optionalDoor'] else set())

    def check_route(self, route, pins, locked_rooms, floor, name, record):
        chests = [pins[s['pinId']] for s in route['stops'] if s['kind'] == 'glass']
        self.assertGreaterEqual(len(chests), 2)
        self.assertEqual(len(chests), route['chestCount'])
        self.assertEqual(len({p['roomId'] for p in chests}), len(chests))
        self.assertTrue(all(p['typeId'] == 2011 and p['roomId'] not in locked_rooms for p in chests))
        if name == 'direct':
            self.assertTrue(all(p['provenance'] == 'scene_reference' for p in chests))
        self.assertEqual(route['stops'][0]['kind'], route['start'])
        self.assertEqual(route['stops'][-1]['kind'], route['end'])
        self.assertEqual(route['points'][0], route['stops'][0]['floorPixel'])
        self.assertEqual(route['points'][-1], route['stops'][-1]['floorPixel'])
        self.check_geometry(route['points'], floor)
        self.assertAlmostEqual(route['distancePixels'], sum(math.dist(a, b) for a, b in zip(route['points'], route['points'][1:])), delta=.01)
        self.assertTrue(all(s['floorPixel'] in route['points'] or self.on_line(s['floorPixel'], route['points']) for s in route['stops']))
        branch = route['optionalDoor']
        if branch:
            self.assertTrue(branch['requiresOrangeKey'])
            self.assertEqual(pins[branch['doorPinId']]['roomId'], pins[branch['chestPinId']]['roomId'])
            self.assertTrue(self.on_line(branch['points'][0], route['points']))
            self.assertEqual(branch['points'][-1], floor.pixel(floor.snap(branch['chestPixel'], 48)))
            self.assertTrue(self.on_line(floor.pixel(floor.snap(branch['doorPixel'], 48)), branch['points']))
            self.assertNotIn(branch['roomId'], {p['roomId'] for p in chests})
            self.assertEqual(pins[branch['chestPinId']]['typeId'], 2011)
            if name == 'direct':
                self.assertEqual(pins[branch['chestPinId']]['provenance'], 'scene_reference')
            world_scale = (abs(record['calibration']['scaleX'])+abs(record['calibration']['scaleZ']))/2
            self.assertLessEqual(branch['detourPixels'], min(route['distancePixels']*.15, 90*world_scale)+.02)
            self.assertAlmostEqual(branch['detourPixels'], 2*sum(math.dist(a, b) for a, b in zip(branch['points'], branch['points'][1:])), delta=.01)
            self.check_geometry(branch['points'], floor)

    @staticmethod
    def on_line(point, points):
        return any(abs(math.dist(a, point)+math.dist(point, b)-math.dist(a, b)) < .001
                   for a, b in zip(points, points[1:]))

    def check_geometry(self, points, floor):
        stairs = {tuple(link['nodes']) for link in floor.stair_links}
        for a, b in zip(points, points[1:]):
            start, end = floor.snap(a, 1), floor.snap(b, 1)
            if (start, end) in stairs or (end, start) in stairs:
                continue
            steps = round(max(abs(b[0]-a[0]), abs(b[1]-a[1]))/floor.step)
            self.assertGreater(steps, 0)
            previous = start
            for i in range(1, steps+1):
                p = [a[k]+(b[k]-a[k])*i/steps for k in (0, 1)]
                node = floor.snap(p, 1)
                self.assertIn(node, {n for n, _ in floor._neighbors[previous]})
                previous = node


if __name__ == '__main__':
    unittest.main()
