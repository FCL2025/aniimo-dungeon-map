"""Check navigable geometry, independent chest stops and detour budgets."""
import itertools
import json
import math
from pathlib import Path
import sys
import unittest

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_routes import Floor, MAP_IDS, ROOT, prepare_plan, shortest_tours


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
        self.assertEqual(sorted(map(int, data['maps'])), list(MAP_IDS))
        for mid in MAP_IDS:
            record = json.loads((ROOT/f'exports/grab-eggs-data/maps/{mid}.json').read_text(encoding='utf8'))
            pins = {p['id']: p for p in record['pins']}
            locked_rooms = {p['roomId'] for p in pins.values() if p['category'] == 'key_orange'}
            floor = Floor(Image.open(ROOT/f'exports/grab-eggs-dungeons/preview/UI_Img_Map_{mid}.png'))
            floor.add_stair_links(record)
            for name, family in data['maps'][str(mid)]['variants'].items():
                self.assertEqual(set(family['options']), {'entrance-entrance', 'entrance-exit', 'exit-entrance', 'exit-exit'})
                self.assertEqual(set(family['selections']), {'auto', 'entrance', 'exit'})
                prepared = {key: prepare_plan(record, floor, name == 'supplements', *key.split('-'))
                            for key in family['options']}
                for key, route in family['options'].items():
                    self.assertEqual(key, f'{route["start"]}-{route["end"]}')
                    self.assertAlmostEqual(route['shortestFourPixels'], prepared[key]['tours'][4][0], delta=.01)
                for start, route in family['selections'].items():
                    allowed = [v for v in prepared.values() if start == 'auto' or v['start'] == start]
                    baseline = min(v['tours'][4][0] for v in allowed)
                    self.assertAlmostEqual(route['shortestFourPixels'], baseline, delta=.01)
                    most = max(n for v in allowed for n, (cost, _) in v['tours'].items()
                               if n >= 4 and cost <= baseline*1.15)
                    self.assertEqual(route['chestCount'], most)
                    if start != 'auto':
                        self.assertEqual(route['start'], start)
                for key, route in [*family['options'].items(), *family['selections'].items()]:
                    with self.subTest(map=mid, variant=name, selection=key):
                        self.check_route(route, pins, locked_rooms, floor, name, record)

    def check_route(self, route, pins, locked_rooms, floor, name, record):
        chests = [pins[s['pinId']] for s in route['stops'] if s['kind'] == 'glass']
        self.assertGreaterEqual(len(chests), 4)
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
        self.assertLessEqual(route['distancePixels'], route['shortestFourPixels']*1.15+.02)
        branch = route['optionalDoor']
        if branch:
            self.assertTrue(branch['requiresOrangeKey'])
            self.assertEqual(pins[branch['doorPinId']]['roomId'], pins[branch['chestPinId']]['roomId'])
            self.assertLessEqual(route['distancePixels']+branch['detourPixels'], route['shortestFourPixels']*1.15+.03)
            world_scale = (abs(record['calibration']['scaleX'])+abs(record['calibration']['scaleZ']))/2
            self.assertLessEqual(branch['detourPixels'], min(route['shortestFourPixels']*.15, 90*world_scale)+.02)
            self.assertAlmostEqual(branch['detourPixels'], 2*sum(math.dist(a, b) for a, b in zip(branch['points'], branch['points'][1:])), delta=.01)
            self.check_geometry(branch['points'], floor)

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
