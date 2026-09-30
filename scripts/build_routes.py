"""Plan short chest circuits on the visible dungeon floor, entirely offline.

The raster is a navigation approximation, not the game's collision/navmesh data.
Raster edges cannot cross blank space, walls, or diagonal corners. The split
stairs in Room_30_004 have a separately annotated template connection.
"""
import argparse
import hashlib
import heapq
import itertools
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MAP_IDS = (20032, 20034, 20035, 20036, 20037, 20039, 20040)
STEP = 8
EXTRA_BUDGET = .15
DOOR_BUDGET = .15


class Floor:
    def __init__(self, image, step=STEP, threshold=100, coverage=5):
        self.step = step
        self.width, self.height = (n // step for n in image.size)
        # Sample each block's interior; dark architectural strokes are obstacles.
        rgba = image.convert('RGBA')
        pixels = rgba.load()
        self.walkable = set()
        for y in range(self.height):
            for x in range(self.width):
                samples = [pixels[x*step+dx, y*step+dy]
                           for dx, dy in itertools.product((2, 4, 6), repeat=2)]
                floor = sum(a > 180 and (r*299+g*587+b*114)/1000 > threshold
                            for r, g, b, a in samples)
                if floor >= coverage:
                    self.walkable.add(y*self.width+x)
        self._neighbors = {node: tuple(self._edges(node)) for node in self.walkable}
        self.stair_links = []
        self._searches = {}

    def add_stair_links(self, record):
        # This template draws two stair landings on separate heights. Link only
        # its two stair ends, never arbitrary nearby disconnected components.
        cal = record['calibration']
        self._searches.clear()
        templates = {'$Level_Room_30_004.prefab': [[(-10, -5), (10, -5)]],
                     '$Level_Room_60_001.prefab': [[(-26, 23), (-26, 7)], [(26, 23), (26, 7)]]}
        for room in record['rooms']:
            if room['prefab'] not in templates:
                continue
            theta = math.radians(room['yaw'])
            for local_ends in templates[room['prefab']]:
                ends = []
                for x, z in local_ends:
                    wx = room['position'][0]+x*math.cos(theta)+z*math.sin(theta)
                    wz = room['position'][2]-x*math.sin(theta)+z*math.cos(theta)
                    pixel = [(wx-cal['worldA'][0])*cal['scaleX']+cal['mapA'][0],
                             -((wz-cal['worldA'][1])*cal['scaleZ']+cal['mapA'][1])]
                    try:
                        ends.append(self.snap(pixel, 32))
                    except ValueError:
                        break
                if len(ends) != 2:
                    continue
                a, b = ends
                distance = math.dist(self.pixel(a), self.pixel(b))
                self._neighbors[a] += ((b, distance),)
                self._neighbors[b] += ((a, distance),)
                self.stair_links.append(dict(roomId=room['id'], nodes=ends,
                                             points=[self.pixel(a), self.pixel(b)], estimated=True))

    def pixel(self, node):
        return [(node % self.width)*self.step+self.step//2,
                (node // self.width)*self.step+self.step//2]

    def snap(self, pixel, max_distance=56):
        x, y = (round((v-self.step//2)/self.step) for v in pixel)
        radius = math.ceil(max_distance/self.step)
        choices = [(gy*self.width+gx) for gy in range(max(0, y-radius), min(self.height, y+radius+1))
                   for gx in range(max(0, x-radius), min(self.width, x+radius+1))
                   if gy*self.width+gx in self.walkable]
        node = min(choices, key=lambda n: math.dist(pixel, self.pixel(n))) if choices else None
        if node is None or math.dist(pixel, self.pixel(node)) > max_distance:
            raise ValueError(f'Point is too far from a visible floor: {pixel}')
        return node

    def _edges(self, node):
        x, y = node % self.width, node // self.width
        for dx, dy in itertools.product((-1, 0, 1), repeat=2):
            if not (dx or dy) or not (0 <= x+dx < self.width and 0 <= y+dy < self.height):
                continue
            other = (y+dy)*self.width+x+dx
            if other not in self.walkable:
                continue
            if dx and dy and (y*self.width+x+dx not in self.walkable or
                              (y+dy)*self.width+x not in self.walkable):
                continue
            yield other, self.step*math.hypot(dx, dy)

    def distances(self, start):
        if start in self._searches:
            return self._searches[start]
        distances, parents, heap = {start: 0.}, {}, [(0., start)]
        while heap:
            cost, node = heapq.heappop(heap)
            if cost > distances[node]:
                continue
            for other, distance in self._neighbors[node]:
                new = cost+distance
                if new < distances.get(other, math.inf):
                    distances[other], parents[other] = new, node
                    heapq.heappush(heap, (new, other))
        self._searches[start] = distances, parents
        return distances, parents

    @staticmethod
    def path(start, end, parents):
        path = [end]
        while path[-1] != start:
            if path[-1] not in parents:
                raise ValueError('No continuous visible-floor path')
            path.append(parents[path[-1]])
        return path[::-1]


def shortest_tours(matrix, count):
    """Exact subset DP: any start, distinct chest stops, then any end."""
    states, parents = {}, {}
    for i in range(count):
        states[1 << i, i] = matrix[0][i+1]
    best = {}
    for mask in range(1, 1 << count):
        size = mask.bit_count()
        for last in range(count):
            key = mask, last
            cost = states.get(key, math.inf)
            if not math.isfinite(cost):
                continue
            total = cost+matrix[last+1][-1]
            if size not in best or total < best[size][0]:
                best[size] = total, key
            for nxt in range(count):
                if mask & (1 << nxt):
                    continue
                next_key = mask | (1 << nxt), nxt
                next_cost = cost+matrix[last+1][nxt+1]
                if next_cost < states.get(next_key, math.inf):
                    states[next_key], parents[next_key] = next_cost, key
    tours = {}
    for size, (cost, key) in best.items():
        order = []
        while key:
            order.append(key[1]+1)
            key = parents.get(key)
        tours[size] = cost, [0, *order[::-1], count+1]
    return tours


def simplify(nodes, floor):
    # Remove only collinear grid points; never smooth through a wall.
    result = []
    protected = {tuple(floor.pixel(node)) for link in floor.stair_links for node in link['nodes']}
    for node in nodes:
        point = floor.pixel(node)
        if len(result) >= 2:
            a, b = result[-2:]
            if (tuple(b) not in protected and (b[0]-a[0])*(point[1]-b[1]) == (b[1]-a[1])*(point[0]-b[0]) and
                    (b[0]-a[0])*(point[0]-b[0])+(b[1]-a[1])*(point[1]-b[1]) > 0):
                result.pop()
        result.append(point)
    return result


def prepare_plan(record, floor, supplements, start, end):
    pins = record['pins']
    portals = {p['category']: p for p in pins if p['category'] in ('entrance', 'exit')}
    doors = {p['roomId']: p for p in pins if p['category'] == 'key_orange'}
    glass = [p for p in pins if p.get('typeId') == 2011 and
             (supplements or p['provenance'] == 'scene_reference')]
    # A room/spawner is one opportunity, even if exports repeat its candidates.
    seen, unlocked = set(), []
    for pin in glass:
        if pin['roomId'] in seen or pin['roomId'] in doors:
            continue
        seen.add(pin['roomId'])
        unlocked.append(pin)
    checkpoints = [portals[start], *unlocked, portals[end]]
    eligible = []
    nodes = []
    omitted = []
    for p in checkpoints:
        try:
            node = floor.snap(p['pixel'], 48)
        except ValueError:
            if p['category'] != 'chest':
                raise
            omitted.append(p['id'])
            continue
        eligible.append(p)
        nodes.append(node)
    checkpoints = eligible
    searches = [floor.distances(node) for node in nodes]
    matrix = [[distances.get(node, math.inf) for node in nodes] for distances, _ in searches]
    reachable = [i for i in range(1, len(nodes)-1) if math.isfinite(matrix[0][i]) and math.isfinite(matrix[i][-1])]
    omitted.extend(checkpoints[i]['id'] for i in range(1, len(nodes)-1) if i not in reachable)
    if len(reachable) < 4:
        raise ValueError(f'{record["id"]}: fewer than four reachable unlocked chests: {len(reachable)}')
    keep = [0, *reachable, len(nodes)-1]
    checkpoints, nodes, searches = ([items[i] for i in keep] for items in (checkpoints, nodes, searches))
    matrix = [[matrix[i][j] for j in keep] for i in keep]
    tours = shortest_tours(matrix, len(reachable))
    return dict(checkpoints=checkpoints, nodes=nodes, searches=searches, tours=tours,
                glass=glass, doors=doors, omitted=omitted, start=start, end=end)


def plan(record, floor, prepared, budget_baseline=None):
    checkpoints, nodes, searches, tours, glass, doors, omitted = (
        prepared[key] for key in ('checkpoints', 'nodes', 'searches', 'tours', 'glass', 'doors', 'omitted'))
    baseline = tours[4][0] if budget_baseline is None else budget_baseline
    feasible = [n for n, (cost, _) in tours.items() if n >= 4 and cost <= baseline*(1+EXTRA_BUDGET)]
    if not feasible:
        return None
    count = max(feasible)
    length, order = tours[count]
    walk = []
    stops = []
    for a, b in zip(order, order[1:]):
        segment = floor.path(nodes[a], nodes[b], searches[a][1])
        walk.extend(segment if not walk else segment[1:])
    for i in order:
        p = checkpoints[i]
        stops.append(dict(pinId=p['id'], roomId=p['roomId'], pixel=p['pixel'],
                          floorPixel=floor.pixel(nodes[i]), kind='glass' if p.get('typeId') == 2011 else p['category'],
                          provenance=p['provenance']))
    optional = None
    world_scale = (abs(record['calibration']['scaleX'])+abs(record['calibration']['scaleZ']))/2
    # Search from each door to the actual main polyline, not just its chest stops.
    for chest in glass:
        if chest['roomId'] not in doors:
            continue
        door = doors[chest['roomId']]
        try:
            door_node, chest_node = floor.snap(door['pixel'], 48), floor.snap(chest['pixel'], 48)
        except ValueError:
            continue
        distances, parents = floor.distances(door_node)
        anchor = min(walk, key=lambda node: distances.get(node, math.inf))
        branch_length = distances.get(anchor, math.inf)+distances.get(chest_node, math.inf)
        detour = branch_length*2
        if detour > min(baseline*DOOR_BUDGET, 90*world_scale) or length+detour > baseline*(1+EXTRA_BUDGET):
            continue
        if optional and detour >= optional['detourPixels']:
            continue
        # Keep door before chest. Return over the same branch; no key acquisition assumed.
        branch = floor.path(door_node, anchor, parents)[::-1]
        branch.extend(floor.path(door_node, chest_node, parents)[1:])
        optional = dict(doorPinId=door['id'], chestPinId=chest['id'], roomId=chest['roomId'],
                        points=simplify(branch, floor), doorPixel=door['pixel'], chestPixel=chest['pixel'],
                        detourPixels=round(detour, 2), requiresOrangeKey=True,
                        stairs=[{k:v for k,v in link.items() if k != 'nodes'} for link in floor.stair_links
                                if any({a,b} == set(link['nodes']) for a,b in zip(branch, branch[1:]))])
    return dict(start=prepared['start'], end=prepared['end'],
                chestCount=count, points=simplify(walk, floor), stops=stops,
                distancePixels=round(length, 2), shortestFourPixels=round(baseline, 2),
                scenarioShortestFourPixels=round(tours[4][0], 2),
                optionalDoor=optional, estimated=True, omittedPinIds=omitted,
                stairs=[{k:v for k,v in link.items() if k != 'nodes'} for link in floor.stair_links
                        if any({a,b} == set(link['nodes']) for a,b in zip(walk, walk[1:]))])


def plan_variants(record, floor, supplements):
    # Compare all four portal combinations against the same distance budget.
    # A forced starting portal gets its own budget, with either end still allowed.
    prepared = {f'{start}-{end}': prepare_plan(record, floor, supplements, start, end)
                for start, end in itertools.product(('entrance', 'exit'), repeat=2)}
    options = {key: plan(record, floor, value) for key, value in prepared.items()}
    selections = {}
    for start in ('auto', 'entrance', 'exit'):
        allowed = [value for value in prepared.values() if start == 'auto' or value['start'] == start]
        baseline = min(value['tours'][4][0] for value in allowed)
        candidates = [plan(record, floor, value, baseline) for value in allowed]
        candidates = [route for route in candidates if route is not None]
        selections[start] = min(candidates, key=lambda r: (
            -r['chestCount'], -bool(r['optionalDoor']),
            r['distancePixels']+(r['optionalDoor']['detourPixels'] if r['optionalDoor'] else 0),
            r['distancePixels'], r['start'] != 'entrance', r['end'] != r['start']))
    return dict(options=options, selections=selections)


def build(output=ROOT/'app/routes.json', previews=None):
    routes = {}
    for mid in MAP_IDS:
        record_path = ROOT/f'exports/grab-eggs-data/maps/{mid}.json'
        image_path = ROOT/f'exports/grab-eggs-dungeons/preview/UI_Img_Map_{mid}.png'
        record = json.loads(record_path.read_text(encoding='utf8'))
        image = Image.open(image_path)
        floor = Floor(image)
        floor.add_stair_links(record)
        variants = {name: plan_variants(record, floor, enabled) for name, enabled in [('direct', False), ('supplements', True)]}
        routes[str(mid)] = dict(variants=variants, sourceSha256=hashlib.sha256(record_path.read_bytes()).hexdigest(),
                                imageSha256=hashlib.sha256(image_path.read_bytes()).hexdigest())
        route = variants['supplements']['selections']['auto']
        print(f'{mid}: {route["start"]} -> {route["end"]}, '
              f'{route["chestCount"]} unlocked glass stops, {route["distancePixels"]:.0f} px, '
              f'orange branch: {route["optionalDoor"]["roomId"] if route["optionalDoor"] else "skip"}')
        if previews:
            previews.mkdir(parents=True, exist_ok=True)
            preview = Image.new('RGB', image.size, '#172731')
            preview.paste(image, mask=image.getchannel('A'))
            draw = ImageDraw.Draw(preview)
            draw.line(route['points'], fill='#87e4f4', width=7)
            if route['optionalDoor']:
                draw.line(route['optionalDoor']['points'], fill='#ffb46e', width=7)
            font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 28)
            for n, stop in enumerate(route['stops'][1:-1], 1):
                x, y = stop['pixel']
                draw.ellipse((x-19, y-19, x+19, y+19), fill='#172731', outline='#87e4f4', width=3)
                draw.text((x, y), str(n), fill='white', font=font, anchor='mm')
            preview.save(previews/f'route-{mid}.png')
    result = dict(version=2, policy=dict(minGlass=4, extraDistanceRatio=EXTRA_BUDGET,
                 orangeDetourRatio=DOOR_BUDGET, orangeDetourWorldLimit=90, gridPixels=STEP,
                 navigation='visible-floor-raster', spawnGuarantee=False,
                 startingPortals=['entrance', 'exit'], leavingPortals=['entrance', 'exit'],
                 preference=['more-unlocked-glass', 'optional-orange-within-budget', 'shorter-total-distance']), maps=routes)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--previews', type=Path)
    args = parser.parse_args()
    build(previews=args.previews)
