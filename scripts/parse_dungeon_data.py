"""Export scoped, offline dungeon candidate positions. Never execute game code."""
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
import zipfile
from PIL import Image

from pmdata import PMData, plain, DEFAULT_ARCHIVE, MEMBER
from luajit_constants import constants
from extract_marker_icons import export_icons

MAP_IDS = [*range(20031, 20061), 29999]
DIFFICULTIES = {5: '惡夢', 6: '混沌'}
BOSS_STELLARYS_TYPE_ID = 11001200090
CATEGORIES = {
    'egg': '蛋巢', 'chest': '寶箱', 'pot': '陶罐', 'cache': '其他搜刮點',
    'stellarys_boss': '首領級幽黯星法師',
    'entrance': '入口', 'exit': '出口', 'key_blue': '藍色鑰匙標記',
    'key_purple': '紫色鑰匙標記', 'key_orange': '橙色鑰匙標記', 'challenge': '限時挑戰',
}
SCOPE = dict(kind='dungeon', sceneIds=MAP_IDS, displayMode='single_base_map',
             loadLayerTextures=False, floorDetection='not_implemented',
             markerHeightPolicy='project_all_heights_to_xz',
             monsterTypeIds=[BOSS_STELLARYS_TYPE_ID])
MARK_CATEGORIES = {1009: 'entrance', 1008: 'exit', 1996: 'key_blue',
                   1997: 'key_purple', 1998: 'key_orange', 1999: 'challenge'}


def vector(t):
    return [t[k] for k in range(1, len(t) + 1)]


def world_position(local, room):
    x, y, z = vector(local)
    ox, oy, oz = vector(room['position'])
    theta = math.radians(room['yaw'])
    c, s = math.cos(theta), math.sin(theta)
    return [x*c + z*s + ox, y + oy, -x*s + z*c + oz]


def calibration(scene):
    a, b = vector(scene['PointAPositon']), vector(scene['PointBPosition'])
    ma, mb = vector(scene['MapAPosition']), vector(scene['MapBPosition'])
    return dict(worldA=a, worldB=b, mapA=ma, mapB=mb,
                scaleX=(mb[0]-ma[0])/(b[0]-a[0]),
                scaleZ=(mb[1]-ma[1])/(b[1]-a[1]))


def world_to_pixel(world, cal):
    return [(world[0]-cal['worldA'][0])*cal['scaleX']+cal['mapA'][0],
            -((world[2]-cal['worldA'][1])*cal['scaleZ']+cal['mapA'][1])]


def instance_id(room_id, source_id):
    return (int(source_id) % 2147483647) * 100 + room_id


def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def scrub(value):
    """Keep relevant source fields; omit editor authors and machine paths."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()
                if k not in ('ownerInfo', 'descriptionEditor')}
    return value


def export(archive, output):
    output.mkdir(parents=True, exist_ok=True)
    (output/'maps').mkdir(exist_ok=True)
    pm = PMData(archive)
    root = pm.root
    with zipfile.ZipFile(archive) as z:
        text_index = json.loads(z.read('xfs/luascripts/Data/I18N/NewTextMap_zh_TW.json'))
        text_blob = z.read('xfs/luascripts/Data/I18N/Compress_zh_TW.bin')
        en_index = json.loads(z.read('xfs/luascripts/Data/I18N/NewTextMap_en.json'))
        en_blob = z.read('xfs/luascripts/Data/I18N/Compress_en.bin')
        members = [MEMBER, 'xfs/luascripts/Common/Const/Const.lua',
                   'xfs/luascripts/Common/Const/RandomMapConst.lua',
                   'xfs/luascripts/Common/Utils/RandomMapBatchUtils.lua',
                   'xfs/luascripts/Common/Utils/MapCoordUtils.lua',
                   'xfs/luascripts/Data/I18N/NewTextMap_zh_TW.json',
                   'xfs/luascripts/Data/I18N/Compress_zh_TW.bin',
                   'xfs/luascripts/Data/I18N/NewTextMap_en.json',
                   'xfs/luascripts/Data/I18N/Compress_en.bin']
        hashes = {m: hashlib.sha256(z.read(m)).hexdigest() for m in members}
        _, const_protos = constants(z.read(members[1]))
        enums = [c for p in const_protos for c in p['constants']
                 if isinstance(c, dict) and any(k in c for k in ('NIGHTMARE', 'PveChaos'))]
        assert any(c.get('NIGHTMARE') == 5 and c.get('CHAOS') == 6 for c in enums)
        _, room_protos = constants(z.read(members[2]))
        room_types = next(c for p in room_protos for c in p['constants']
                          if isinstance(c, dict) and 'Aisle' in c)
        # Preserve narrow bytecode evidence for the transformations and selection rules.
        evidence = {}
        for member, indices in [(members[3], [14, 16, 34, 35, 41]), (members[4], [0, 2])]:
            _, protos = constants(z.read(member))
            evidence[member] = {i: {**protos[i], 'bytecode': protos[i]['bytecode'].hex()}
                                for i in indices}
        dump(output/'bytecode-evidence.json', evidence)

    def loc(key):
        entry = text_index.get(str(key))
        return text_blob[entry[0]:entry[0]+entry[1]].decode('utf-8') if entry else str(key)

    def loc_en(key):
        entry = en_index.get(str(key))
        return en_blob[entry[0]:entry[0]+entry[1]].decode('utf-8') if entry else str(key)

    sandboxes = root['Scene.10000.scene_sandbox_data']
    entities = root['Scene.10000.scene_entity_data']
    spawners = root['Scene.10000.scene_spawner_data']
    marks = root['Scene.10000.scene_mark_point_data']
    chest_types = root['rob_egg_chest_data']
    puppets = root['puppet_data']
    # Only the explicitly requested dungeon boss, not ordinary Stellarys or other monsters.
    monster_types = {}
    for entity in entities.values():
        if entity['subType'] != 'Puppet':
            continue
        type_id = int(entity['idInType'])
        cfg = puppets.get(type_id, {})
        if (type_id == BOSS_STELLARYS_TYPE_ID and cfg.get('monsterType') == 2
                and cfg.get('baseFormPet') == 1001200 and '星法師' in loc(cfg.get('name'))):
            monster_types[type_id] = cfg
    if BOSS_STELLARYS_TYPE_ID not in monster_types:
        raise ValueError('Requested dungeon boss not found; recheck game version and puppet data')
    mark_types = root['default_map_mark_data']
    icon_catalog = export_icons(root, output, MARK_CATEGORIES, BOSS_STELLARYS_TYPE_ID)
    template_rooms = root['Scene.10000.scene_room_data']
    templates_by_prefab = defaultdict(list)
    for tid, template in template_rooms.items():
        templates_by_prefab[template['resId']].append((tid, set(template['sandboxIds'].values())))
    entities_by_sandbox, marks_by_sandbox, monsters_by_sandbox = defaultdict(list), defaultdict(list), defaultdict(list)
    for entity_id, entity in entities.items():
        if entity['subType'] == 'ResourceBox':
            entities_by_sandbox[entity['sandboxId']].append((entity_id, entity))
        elif entity['subType'] == 'Puppet' and entity['idInType'] in monster_types:
            monsters_by_sandbox[entity['sandboxId']].append((entity_id, entity))
    for mark_id, mark in marks.items():
        if mark['markConfigId'] in MARK_CATEGORIES:
            marks_by_sandbox[mark['sandboxId']].append((mark_id, mark))

    reward_rules = {k: plain(v) for k, v in root['digong_reward_data'].items()
                    if k.startswith(('Nightmare-', 'Chaos-'))}
    difficulty_records = {k: plain(root['dungeon_difficult_level_data'][3005][k]) for k in DIFFICULTIES}
    source = dict(archive=str(archive), resourceVersion=3595896, sha256=hashes,
                  rootTableCount=len(root), rootTableOffset=pm.root.pos,
                  sourceScene=10000, offlineOnly=True, scope=SCOPE)
    dump(output/'source.json', source)
    dump(output/'difficulty.json', dict(difficulties=DIFFICULTIES, enums=enums,
         roomTypes=room_types, pveSceneId=3005, pvpSceneId=3004,
         records=difficulty_records, rewardRules=reward_rules))
    dump(output/'reward-types.json', {k: dict(name=loc(v.get('name')), config=scrub(plain(v)))
                                     for k, v in chest_types.items()
                                     if k in {e['idInType'] for es in entities_by_sandbox.values() for _, e in es}})
    dump(output/'monster-types.json', {k: dict(name=loc(v['name']), englishName=loc_en(v['name']),
         config=scrub(plain(v))) for k, v in monster_types.items()})
    dump(output/'display-policy.json', dict(scope=SCOPE,
         sceneFloorConfigs={name: [mid for mid in MAP_IDS if mid in root[name]]
                            for name in ('map_layer_level_data', 'map_level_config_data',
                                         'map_level_config_load_data')}))

    reference_path = output.parent/'grab-eggs-dungeons/reference-matches.json'
    references = json.loads(reference_path.read_text(encoding='utf-8')) if reference_path.exists() else {}
    # The extraction stage's result has a top-level matches list.
    matches = references.get('matches', []) if isinstance(references, dict) else references
    ref_by_id = {}
    for match in matches:
        mid = match.get('map_id', match.get('mapId'))
        if mid is not None:
            ref_by_id[int(mid)] = match.get('reference', match.get('reference_file', ''))

    map_records, total_counts = [], Counter()
    validations = dict(missingReferences=[], outsideImage=[], mapChecks=[], templateMatches=[],
                       coordinateMethod='room yaw/translation -> scene two-point calibration -> negate UI y')
    used_sandbox_ids = set()
    for map_id in MAP_IDS:
        scene = root['scene_data'][map_id]
        rooms = root[f'Scene.{map_id}.scene_room_data']
        cal = calibration(scene)
        pins, room_records = [], []
        for room_id, room in rooms.items():
            direct_sids = set(room['sandboxIds'].values())
            # Same prefab can have several key-room variants: never union all of them.
            ranked = sorted(((len(direct_sids & ids)/len(direct_sids | ids)
                              if direct_sids | ids else 1, tid, ids)
                             for tid, ids in templates_by_prefab[room['resId']]),
                            key=lambda x: (-x[0], x[1]))
            template_id, supplement = None, set()
            if ranked and ranked[0][0] >= 0.7:
                best = [v for v in ranked if v[0] == ranked[0][0]]
                if all(v[2] == best[0][2] for v in best):
                    template_id, supplement = best[0][1], best[0][2] - direct_sids
            if supplement:
                validations['templateMatches'].append(dict(mapId=map_id, roomId=room_id,
                    templateId=template_id, jaccard=ranked[0][0], addedSandboxIds=sorted(supplement)))
            room_records.append(dict(id=room_id, prefab=room['resId'], type=room['roomType'],
                 depth=room['depth'], yaw=room['yaw'], position=vector(room['position']),
                 pixel=world_to_pixel(vector(room['position']), cal),
                 sandboxIds=vector(room['sandboxIds']), templateId=template_id,
                 supplementalSandboxIds=sorted(supplement)))
            for sandbox_id in sorted(direct_sids | supplement):
                if sandbox_id not in sandboxes:
                    validations['missingReferences'].append([map_id, room_id, 'sandbox', sandbox_id])
                    continue
                used_sandbox_ids.add(sandbox_id)
                sandbox = sandboxes[sandbox_id]
                config_type, level = sandbox.get('sandBoxConfigType', 0), sandbox['sandBoxLevel']
                eligible = [level] if config_type == 4 and level in DIFFICULTIES else [5, 6]
                if config_type == 4 and level not in DIFFICULTIES:
                    continue
                rule_kind = 'hallway' if room['roomType'] == room_types['Aisle'] else 'room'
                group_values = {d: reward_rules[f'{name}-{rule_kind}'].get(f'G{level}')
                                for d, name in [(5, 'Nightmare'), (6, 'Chaos')]} if config_type == 2 else None

                def base_pin(source_id, position, category, name, source_table):
                    world = world_position(position, room)
                    pixel = world_to_pixel(world, cal)
                    pin = dict(id=f'{map_id}:{room_id}:{source_table}:{source_id}',
                         category=category, name=name, roomId=room_id,
                         sourceId=source_id, instanceId=instance_id(room_id, source_id),
                         sourceTable=source_table, sandboxId=sandbox_id,
                         sandboxInstanceId=instance_id(room_id, sandbox_id),
                         sandboxConfigType=config_type, sandboxLevel=level,
                         graphId=sandbox.get('graphId', 0),
                         difficultyCandidates=eligible, groupConfig=group_values,
                         local=vector(position), world=[round(v, 6) for v in world],
                         pixel=[round(v, 4) for v in pixel],
                         provenance='template_supplement' if sandbox_id in supplement else 'scene_reference',
                         templateId=template_id if sandbox_id in supplement else None,
                         status='candidate', spawnConfirmed=False)
                    if not (0 <= pixel[0] < 2048 and 0 <= pixel[1] < 2048):
                        validations['outsideImage'].append(pin['id'])
                    return pin

                for entity_id, entity in entities_by_sandbox[sandbox_id]:
                    type_id = entity['idInType']
                    if type_id not in chest_types:
                        validations['missingReferences'].append([map_id, entity_id, 'chestType', type_id])
                        continue
                    cfg = chest_types[type_id]
                    category = ('egg' if type_id == 10 else 'pot' if cfg['lootboxType'] == 5
                                else 'cache' if 3000 <= type_id < 4000 else 'chest')
                    pin = base_pin(entity_id, entity['position'], category, loc(cfg['name']), 'entity')
                    spawner_id = entity.get('spawnerId', 0)
                    spawner = spawners.get(spawner_id)
                    if spawner_id and spawner is None:
                        validations['missingReferences'].append([map_id, entity_id, 'spawner', spawner_id])
                    pin.update(typeId=type_id, iconKey=icon_catalog['rewardTypes'][type_id],
                               quality=cfg['quality'], spawnerId=spawner_id,
                               spawnType=spawner.get('spawnType') if spawner else None,
                               rewardGroups={d: plain(cfg.get('rewardGroup', {}).get(d, {})) for d in eligible})
                    pins.append(pin)
                for entity_id, entity in monsters_by_sandbox[sandbox_id]:
                    type_id = int(entity['idInType'])
                    cfg = monster_types[type_id]
                    pin = base_pin(entity_id, entity['position'], 'stellarys_boss', loc(cfg['name']), 'entity')
                    spawner_id = entity.get('spawnerId', 0)
                    spawner = spawners.get(spawner_id)
                    if spawner_id and spawner is None:
                        validations['missingReferences'].append([map_id, entity_id, 'monsterSpawner', spawner_id])
                    groups = [] if spawner is None else [
                        dict(id=int(gid), weight=group.get('weight'))
                        for gid, group in spawner.get('spawnGroups', {}).items()
                        if entity_id in group.get('spawnIds', {}).values()]
                    pin.update(typeId=type_id, iconKey=icon_catalog['boss']['icon'], englishName=loc_en(cfg['name']),
                               monsterType=cfg.get('monsterType'), isBoss=cfg.get('monsterType') == 2,
                               spawnerId=spawner_id, spawnType=spawner.get('spawnType') if spawner else None,
                               spawnGroupCandidates=groups)
                    pins.append(pin)
                for mark_id, mark in marks_by_sandbox[sandbox_id]:
                    type_id = mark['markConfigId']
                    cfg = mark_types[type_id]
                    pin = base_pin(mark_id, mark['markPosition'], MARK_CATEGORIES[type_id],
                                   loc(mark.get('infoTitle', cfg['infoTitle'])), 'mark')
                    pin.update(typeId=type_id, icon=cfg['icon'], iconKey=icon_catalog['markTypes'][type_id])
                    pins.append(pin)

        assert len({p['id'] for p in pins}) == len(pins)
        portal_checks = []
        for direction, groups in root['digong_config_data'][map_id].items():
            if direction not in ('entrance', 'exit'):
                continue
            for group in groups.values():
                for combined in group.values():
                    sid, rid = divmod(int(combined), 100)
                    valid = rid in rooms and sid in rooms[rid]['sandboxIds'].values()
                    matched = [p for p in pins if p['sandboxInstanceId'] == combined and p['category'] == direction]
                    portal_checks.append(dict(kind=direction, instanceId=int(combined),
                                              roomId=rid, valid=valid and bool(matched)))
        assert portal_checks and all(p['valid'] for p in portal_checks), (map_id, portal_checks)
        for w, m in [(cal['worldA'], cal['mapA']), (cal['worldB'], cal['mapB'])]:
            actual = world_to_pixel([w[0], 0, w[1]], cal)
            assert math.isclose(actual[0], m[0], abs_tol=1e-7) and math.isclose(actual[1], -m[1], abs_tol=1e-7)
        counts = Counter(p['category'] for p in pins)
        total_counts.update(counts)
        image_path = output.parent/f'grab-eggs-dungeons/preview/UI_Img_Map_{map_id}.png'
        with Image.open(image_path) as im:
            bounds = im.getchannel('A').getbbox()
        record = dict(id=map_id, name=scene['name'], reference=ref_by_id.get(map_id, ''),
                      image=f'../grab-eggs-dungeons/preview/UI_Img_Map_{map_id}.png',
                      displayMode=SCOPE['displayMode'],
                      size=vector(scene['mapUISize']), bounds=bounds, calibration=cal, rooms=room_records,
                      counts=counts, pins=pins)
        dump(output/'maps'/f'{map_id}.json', record)
        map_records.append(record)
        validations['mapChecks'].append(dict(mapId=map_id, rooms=len(rooms), pins=len(pins), portals=portal_checks))

    # Narrow source rows used to produce the candidate dataset, allowing independent checks.
    dump(output/'source-tables.json', dict(
        templateRooms=scrub(plain(template_rooms)),
        scenes={k: scrub(plain(root['scene_data'][k])) for k in MAP_IDS},
        rooms={k: scrub(plain(root[f'Scene.{k}.scene_room_data'])) for k in MAP_IDS},
        sandboxes={k: scrub(plain(sandboxes[k])) for k in sorted(used_sandbox_ids)},
        resourceEntities={k: scrub(plain(v)) for k, v in entities.items()
                          if v['subType'] == 'ResourceBox' and v['sandboxId'] in used_sandbox_ids},
        monsterEntities={k: scrub(plain(v)) for k, v in entities.items()
                         if v['subType'] == 'Puppet' and v['idInType'] in monster_types
                         and v['sandboxId'] in used_sandbox_ids},
        spawners={k: scrub(plain(v)) for k, v in spawners.items() if v['sandboxId'] in used_sandbox_ids},
        marks={k: scrub(plain(v)) for k, v in marks.items() if v['sandboxId'] in used_sandbox_ids},
        portalConfigs={k: plain(root['digong_config_data'][k]) for k in MAP_IDS}))
    validations.update(mapCount=len(map_records), counts=total_counts,
                       monsterTypeIds=sorted(monster_types),
                       bossCandidatesByDifficulty={d: sum(p['category'] == 'stellarys_boss'
                           and d in p['difficultyCandidates'] for m in map_records for p in m['pins'])
                           for d in DIFFICULTIES},
                       candidateCount=sum(total_counts.values()),
                       provenanceCounts=Counter(p['provenance'] for m in map_records for p in m['pins']),
                       missingSandboxIds=sorted({v[3] for v in validations['missingReferences'] if v[2]=='sandbox'}),
                       status='complete_with_source_gaps' if validations['missingReferences'] else 'complete',
                       uniqueCandidateIds=len({p['id'] for m in map_records for p in m['pins']}))
    dump(output/'validation.json', validations)
    # Missing source rows remain explicit; they are not fabricated or silently replaced.
    fields = ['mapId', 'roomId', 'category', 'name', 'typeId', 'sourceId', 'sandboxId',
              'sandboxConfigType', 'sandboxLevel', 'difficultyCandidates', 'worldX', 'worldY', 'worldZ',
              'pixelX', 'pixelY', 'graphId', 'provenance', 'status']
    with (output/'candidates.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for m in map_records:
            for p in m['pins']:
                row = {k: p.get(k) for k in fields}
                row.update(mapId=m['id'], category=CATEGORIES[p['category']],
                           difficultyCandidates='/'.join(DIFFICULTIES[d] for d in p['difficultyCandidates']),
                           **dict(zip(['worldX', 'worldY', 'worldZ'], p['world'])),
                           **dict(zip(['pixelX', 'pixelY'], p['pixel'])))
                writer.writerow(row)
    # Keep the full audit exports; apply the same display policy as the desktop app.
    from build_viewer import build
    build(output)
    print(json.dumps({k: validations[k] for k in ('mapCount', 'candidateCount', 'counts',
                                                'missingReferences', 'outsideImage')}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', default=DEFAULT_ARCHIVE)
    parser.add_argument('--output', type=Path, default=Path('exports/grab-eggs-data'))
    args = parser.parse_args()
    export(args.archive, args.output)
