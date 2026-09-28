"""Audit fixed dungeon portals against the local game archive, without executing Lua."""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Measured from the 1920x1080 explored 20040 fixture's 184-inlier terrain fit.
# All audited dungeons use 1.58 at the farthest zoom. Keep this calibration
# optional when an asset version introduces a different zoom configuration.
DEFAULT_VIEW = dict(mapImageScale=1.58, pixelsPerMapPixel1080=.63158,
                    fixture='real-20040-explored.png',
                    calibrationResults='exports/recognition-fixtures/results-0.2.2.json',
                    calibrationSample='real-explored-live', toleranceFraction=.03, tolerancePixels1080=14)


def portal_geometry(record, map_image_scale=None):
    """Coordinates stay in the original map's pixels; never screen pixels."""
    anchors = {}
    for kind in ('entrance', 'exit'):
        pins = [p for p in record['pins'] if p['category'] == kind
                and p['provenance'] == 'scene_reference']
        if len(pins) != 1:
            return None
        anchors[kind] = pins[0]['pixel']
    dx, dy = (anchors['exit'][i] - anchors['entrance'][i] for i in range(2))
    distance = math.hypot(dx, dy)
    scales = list(map_image_scale.values()) if map_image_scale else []
    calibrated = bool(scales) and math.isclose(min(scales), DEFAULT_VIEW['mapImageScale'], abs_tol=1e-6)
    return dict(**anchors, distance=round(distance, 4),
                angleDegrees=round(math.degrees(math.atan2(dy, dx)), 4),
                defaultDistance1080=round(distance*DEFAULT_VIEW['pixelsPerMapPixel1080'], 4) if calibrated else None)


def audit(archive):
    from pmdata import PMData, plain
    from parse_dungeon_data import calibration, world_position, world_to_pixel
    pm = PMData(archive)
    measured = json.loads((ROOT/DEFAULT_VIEW['calibrationResults']).read_text(encoding='utf8'))
    sample = next(r for r in measured['results'] if r['name'] == DEFAULT_VIEW['calibrationSample'])
    best = sample['ranked'][0]
    assert best['id'] == 20040 and best['inliers'] == 184
    t = best['model']
    # The baseline downsamples 1920 pixels to 1200; reference features are at
    # 1024 pixels while the original map is 2048. Undo both before calibration.
    measured_scale = 1/(math.hypot(t['a'], t['b'])*(1200/1920)*(2048/1024))
    assert math.isclose(measured_scale, DEFAULT_VIEW['pixelsPerMapPixel1080'], abs_tol=1e-5)
    rows = []
    for path in sorted((ROOT/'exports/grab-eggs-data/maps').glob('*.json')):
        record = json.loads(path.read_text(encoding='utf8'))
        mid = record['id']
        scene = pm.root['scene_data'][mid]
        rooms = pm.root[f'Scene.{mid}.scene_room_data']
        config = pm.root['digong_config_data'][mid]
        geometry = portal_geometry(record, plain(scene['mapImageScale']))
        assert geometry is not None, mid
        assert list(scene['mapUISize'].values()) == record['size'], mid
        for kind in ('entrance', 'exit'):
            pin, = [p for p in record['pins'] if p['category'] == kind]
            ids = [int(v) for group in config[kind].values() for v in group.values()]
            assert ids == [pin['sandboxInstanceId']], (mid, kind, ids)
            mark = pm.root['Scene.10000.scene_mark_point_data'][pin['sourceId']]
            room = rooms[pin['roomId']]
            assert mark['markConfigId'] == pin['typeId']
            assert pm.root['default_map_mark_data'][pin['typeId']]['icon'] == pin['icon']
            assert mark['sandboxId'] in room['sandboxIds'].values()
            actual = world_to_pixel(world_position(mark['markPosition'], room), calibration(scene))
            assert math.dist(actual, geometry[kind]) < .001, (mid, kind, actual)
        rows.append(dict(id=mid, size=record['size'], **geometry,
                         mapImageScale=plain(scene['mapImageScale']),
                         defaultScaleRatio=scene['mapSwitchDefaultScaleRatio']))
    neighbors, default_neighbors = [], []
    for row in rows:
        neighbors.append(sum(abs((r['angleDegrees'] - row['angleDegrees'] + 180) % 360 - 180) <= 8
                             for r in rows))
        default_neighbors.append(sum(
            abs((r['angleDegrees'] - row['angleDegrees'] + 180) % 360 - 180) <= 8
            and r['defaultDistance1080'] is not None and row['defaultDistance1080'] is not None
            and abs(r['defaultDistance1080']-row['defaultDistance1080']) <= max(
                DEFAULT_VIEW['tolerancePixels1080'], r['defaultDistance1080']*DEFAULT_VIEW['toleranceFraction'])
            for r in rows))
    return dict(archive=str(archive), pmdataSha256=hashlib.sha256(pm.data).hexdigest(),
                verifiedPortals=2*len(rows), maps=rows,
                directionWindowDegrees=8, directionCandidates=dict(min=min(neighbors), max=max(neighbors),
                mean=round(sum(neighbors)/len(neighbors), 2)),
                defaultView=DEFAULT_VIEW, defaultViewCandidates=dict(min=min(default_neighbors), max=max(default_neighbors),
                mean=round(sum(default_neighbors)/len(default_neighbors), 2)),
                note='Primary path assumes the user-confirmed default farthest zoom; screen distances are normalized to 1920x1080.')


if __name__ == '__main__':
    from pmdata import DEFAULT_ARCHIVE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', default=DEFAULT_ARCHIVE)
    parser.add_argument('--output', type=Path, default=ROOT/'exports/recognition-fixtures/portal-geometry.json')
    args = parser.parse_args()
    result = audit(args.archive)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({k: result[k] for k in ('verifiedPortals', 'pmdataSha256', 'directionCandidates', 'defaultViewCandidates')}))
