"""Export the Grab Eggs M-map fog texture and fog grid settings. Read-only; never writes to the game."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import zipfile

import UnityPy

from build_viewer import active_map_ids
from extract_maps import read_manifest
from pmdata import MEMBER, PMData, plain

ROOT = Path(__file__).resolve().parent.parent
GAME = Path(r'F:\Pawprint\Aniimo\game')
MATERIAL = 'Assets/Res/XGUI/Panel/GameMod_GrabEggs/Mat/MI_UI_MapFog_GrabEgg.mat'
SHADER = 'Packages/xgui/Runtime/Renderer/Shader/MapFog.shader'
TEXTURE_PROPERTY = '_ThickFogTex'
# Screen-space masks of the map panel. Their layout lives in the panel prefab, so
# view calibration measures the combined vignette from captures instead.
PANEL_MASKS = ['Assets/Res/XGUI/Panel/Map/Image/UI_Img_Map_Mask.png',
               'Assets/Res/XGUI/Panel/Map/Image/UI_Img_Map_Mask2.png',
               'Assets/Res/XGUI/Panel/Map/Image/UI_Img_Map_SideMask.png',
               'Assets/Res/XGUI/Panel/Map/Image/UI_Img_WorldMap_BgMask.png']


def latest_manifest(game):
    folder = game/'Aniimo_Data/cvs/res/uab/win/DefaultPackage/ManifestFiles'
    versions = [int(m[1]) for p in folder.glob('PackageManifest_DefaultPackage_*.bytes')
                if (m := re.fullmatch(r'PackageManifest_DefaultPackage_(\d+)\.bytes', p.name))]
    if not versions:
        raise FileNotFoundError(f'No resource manifest under {folder}')
    return str(max(versions))


def latest_pmdata(game):
    res = game/'Aniimo_Data/cvs/res'
    patches = sorted((res/'patchv2/lua/ver').glob('*/LuaScripts.xdf'), key=lambda p: int(p.parent.name))
    for archive in reversed(patches):
        with zipfile.ZipFile(archive) as z:
            if MEMBER in z.namelist():
                return archive
    return res/'lua/LuaScripts.xdf'


def material_properties(tree):
    props = tree['m_SavedProperties']
    textures = {name: dict(scale=[env['m_Scale']['x'], env['m_Scale']['y']],
                           offset=[env['m_Offset']['x'], env['m_Offset']['y']],
                           assigned=bool(env['m_Texture']['m_PathID']))
                for name, env in props['m_TexEnvs']}
    return dict(textures=textures, floats=dict(props['m_Floats']),
                colors={k: [v['r'], v['g'], v['b'], v['a']] for k, v in props['m_Colors']},
                ints=dict(props.get('m_Ints', [])),
                invalidKeywords=tree.get('m_InvalidKeywords', []), validKeywords=tree.get('m_ValidKeywords', []))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', type=Path, default=GAME)
    parser.add_argument('--version', help='Resource manifest version (default: newest local manifest)')
    parser.add_argument('--output', type=Path, default=ROOT/'exports/map-fog')
    args = parser.parse_args()
    game, output = args.game.resolve(), args.output.resolve()
    if output == game or game in output.parents:
        raise ValueError('Output must be outside the game directory')
    version = args.version or latest_manifest(game)
    assets, bundles, meta = read_manifest(game, version)
    by_path = {a['path']: a for a in assets}
    entry = by_path[MATERIAL]
    files = [bundles[entry['bundle_id']], *(bundles[i] for i in entry['dependencies'])]
    for bundle in files:
        if Path(bundle['file']).stat().st_size != bundle['size']:
            raise ValueError(f'Bundle size differs from manifest: {bundle["name"]}')
    env = UnityPy.load(*(b['file'] for b in files))
    container = dict(env.container.items())
    material = container[MATERIAL]
    tree = material.read_typetree()
    shader = material.read().m_Shader.deref()
    if container.get(SHADER) is None or container[SHADER].path_id != shader.path_id:
        raise ValueError('Fog material no longer references the XGUI MapFog shader')
    texture_ref = next(env for name, env in material.read().m_SavedProperties.m_TexEnvs if name == TEXTURE_PROPERTY)
    texture = texture_ref.m_Texture.deref().read()
    output.mkdir(parents=True, exist_ok=True)
    texture_path = output/f'{texture.m_Name}.png'
    texture.image.save(texture_path)
    texture_asset, = [a for a in assets if a['path'].endswith(f'/{texture.m_Name}.png')
                      and bundles[a['bundle_id']] in files]
    texture_bundle = bundles[texture_asset['bundle_id']]

    archive = latest_pmdata(game)
    with zipfile.ZipFile(archive) as z:
        pmdata_sha = hashlib.sha256(z.read(MEMBER)).hexdigest()
    table = PMData(str(archive)).root['dungeon_fog_data']
    map_ids = active_map_ids(ROOT/'exports/grab-eggs-data')
    grids = {str(mid): plain(table[mid]) for mid in map_ids}
    distinct = {json.dumps(g, sort_keys=True) for g in grids.values()}
    if len(distinct) != 1:
        raise ValueError('Map pool uses more than one fog grid; the view renderer assumes a single grid')

    result = dict(
        created_at=datetime.now(timezone.utc).isoformat(), offlineOnly=True,
        source=dict(manifest=meta, material=MATERIAL, materialBundle=bundles[entry['bundle_id']]['name'],
                    shader=SHADER, texture=dict(property=TEXTURE_PROPERTY, name=texture.m_Name, path=texture_asset['path'],
                                                bundle=texture_bundle['name'], bundleHash=texture_bundle['hash'],
                                                size=[texture.m_Width, texture.m_Height],
                                                format=int(texture.m_TextureFormat)),
                    pmdata=dict(archive=str(archive), member=MEMBER, sha256=pmdata_sha),
                    panelMasks=[p for p in PANEL_MASKS if p in by_path]),
        material=material_properties(tree),
        fogGrid=json.loads(distinct.pop()), fogGridMapIds=map_ids,
        files={texture_path.name: hashlib.sha256(texture_path.read_bytes()).hexdigest()},
        tool_versions={'UnityPy': UnityPy.__version__},
        note=('The fog texture spans fogGrid.desiredMapSize map pixels centred on the 2048-pixel map image. '
              'Revealed cells are unitPixel map pixels wide; explorePixelRadius is counted in cells.'))
    (output/'source.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(f'Fog texture {texture.m_Name} {texture.m_Width}x{texture.m_Height}, grid {result["fogGrid"]}, '
          f'resource {meta["version"]} -> {output}')


if __name__ == '__main__':
    main()
