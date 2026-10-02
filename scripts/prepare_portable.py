"""Stage only dungeon viewer assets for the Tauri executable; no game reads required."""
import hashlib
import json
from pathlib import Path
import shutil
from app_icons import stage_app_icons
from build_viewer import CATEGORIES, active_map_ids, display_pins, display_icons
from analyze_portal_geometry import portal_geometry
from build_routes import build as build_routes
from build_i18n import stage_i18n
from build_loot_ranking import stage_loot_ranking

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT/'app/frontend'
VERSION = json.loads((ROOT/'app/src-tauri/tauri.conf.json').read_text(encoding='utf8'))['version']
OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT/'maps').mkdir(exist_ok=True)
source = ROOT/'exports/grab-eggs-data'
scenes = json.loads((source/'source-tables.json').read_text(encoding='utf8'))['scenes']
policy = json.loads((source/'display-policy.json').read_text(encoding='utf8'))['scope']
assert policy['kind'] == 'dungeon' and policy['loadLayerTextures'] is False
assert policy['monsterTypeIds'] == [11001200090]
allowed = set(active_map_ids(source))
map_output = (OUTPUT/'maps').resolve()
for old_map in (OUTPUT/'maps').glob('*.png'):
    assert old_map.resolve().parent == map_output
    if old_map.stem not in {str(mid) for mid in allowed}:
        old_map.unlink()
maps = []
routes = build_routes()['maps']
pin_keys = ('id', 'category', 'name', 'iconKey', 'roomId', 'sourceId', 'sandboxConfigType', 'sandboxLevel',
            'difficultyCandidates', 'world', 'pixel', 'provenance', 'quality', 'graphId', 'isBoss', 'typeId', 'originalName')
for mid in sorted(allowed):
    original = json.loads((source/'maps'/f'{mid}.json').read_text(encoding='utf8'))
    record = {k: original[k] for k in ('id', 'size', 'bounds')}
    record['image'] = f'maps/{mid}.png'
    record['portalGeometry'] = portal_geometry(original, scenes[str(mid)]['mapImageScale'])
    record['routes'] = routes[str(mid)]['variants']
    record['pins'] = [{k: p[k] for k in pin_keys if k in p} for p in display_pins(original['pins'])]
    maps.append(record)
    shutil.copyfile(ROOT/'exports/grab-eggs-dungeons/preview'/f'UI_Img_Map_{mid}.png', OUTPUT/record['image'])
difficulty = json.loads((source/'difficulty.json').read_text(encoding='utf8'))
validation = json.loads((source/'validation.json').read_text(encoding='utf8'))
icon_catalog = json.loads((source/'marker-icons.json').read_text(encoding='utf8'))
(OUTPUT/'icons').mkdir(exist_ok=True)
for asset in icon_catalog['assets'].values():
    icon = source/asset['image']
    assert hashlib.sha256(icon.read_bytes()).hexdigest() == asset['sha256']
    shutil.copyfile(icon, OUTPUT/asset['image'])
assert all(p['iconKey'] in icon_catalog['assets'] for m in maps for p in m['pins'])
data = dict(categories=CATEGORIES, icons=display_icons(icon_catalog), difficulties=difficulty['difficulties'], rewardRules=difficulty['rewardRules'],
            maps=maps, validation={'missingReferences': validation['missingReferences']}, scope=policy)
(OUTPUT/'data.js').write_text('window.DUNGEON_DATA='+json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')+';', encoding='utf8')
for name in ('viewer.js', 'viewer.css', 'i18n.js', 'i18n.css', 'loot-ranking.js', 'loot-ranking.css'):
    shutil.copyfile(ROOT/'scripts/data_viewer'/name, OUTPUT/name)
for name in ('desktop.js', 'overlay.js', 'desktop.css', 'manual-map.js', 'manual-map-core.js', 'manual-map.css', 'recognition.js', 'recognition.css', 'recognition-worker.js', 'recognition-core.js', 'recognition-vision.js', 'recognition-portals.js', 'recognition-search.js', 'recognition-fog.js', 'fog-references.json', 'tracking-core.js', 'tracking-worker.js', 'map-header.js', 'recognition-screen.js'):
    shutil.copyfile(ROOT/'app'/name, OUTPUT/name)
shutil.copytree(ROOT/'app/vendor', OUTPUT/'vendor', dirs_exist_ok=True)
html = (ROOT/'scripts/data_viewer/index.html').read_text(encoding='utf8')
html = html.replace('<title>搶蛋地圖 · 點位解析</title>', '<title>伊莫地城地圖 · 可攜版</title>')
html = html.replace('<body>', '<body class="desktop-app">')
html = html.replace('<link rel="stylesheet" href="viewer.css">', '<link rel="stylesheet" href="viewer.css"><link rel="stylesheet" href="desktop.css"><link rel="stylesheet" href="recognition.css"><link rel="stylesheet" href="manual-map.css">')
html = html.replace('<h1>地宮點位解析</h1>', '<h1>地城地圖</h1>')
html = html.replace('<aside>', '<aside id="sidebar" aria-label="地圖與篩選設定">')
html = html.replace('資源版本 3595896 · 本機資料', f'可攜版 {VERSION} · 資源 3595896')
html = html.replace('<footer>', '''<button id="help-button" type="button">說明</button>
<label class="check debug-log-control" title="開啟後才寫入辨識診斷紀錄"><input type="checkbox" id="debug-log"><span>DEBUG LOG（辨識診斷）</span></label>
<footer>''', 1)
html = html.replace('<div><span class="eyebrow" id="map-id"></span><h2 id="map-title"></h2></div>', '''<div class="mapbar-start"><button id="sidebar-toggle" aria-expanded="true" aria-controls="sidebar" aria-label="收合側欄" title="收合側欄"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path class="sidebar-arrow" d="m16 9-3 3 3 3"/></svg></button><div class="map-heading"><span class="eyebrow" id="map-id"></span><div class="session-heading"><h2 id="map-title"></h2><span id="live-status" role="status"></span></div></div></div>''')
html = html.replace('<div class="tools">', '<div class="tools"><button id="recognition-button" class="live-switch" role="switch" aria-checked="false">辨識：關</button><button id="manual-map-button" type="button" aria-haspopup="dialog" aria-controls="manual-map-dialog"></button><button id="tracking-button" class="live-switch" role="switch" aria-checked="false">追蹤：關</button><button id="topmost" aria-pressed="true">置頂：開</button><button id="compact" aria-pressed="false">地圖模式</button>')
notice_start = html.index('  <p class="notice">')
notice_end = html.index('</p>', notice_start) + len('</p>')
notice = html[notice_start:notice_end]
html = html[:notice_start] + html[notice_end:]
html = html.replace('<div class="stage">', '<div class="stage">' + notice + '<p id="app-status" role="status" hidden></p><div class="player-tools"><span id="player-status" class="sr-only" role="status">等待人物定位</span><button id="locate-player" title="置中到人物位置" aria-label="置中到人物位置" hidden disabled>◎</button></div>')
html = html.replace('<noscript>', (ROOT/'app/help.html').read_text(encoding='utf8')+(ROOT/'app/manual-map.html').read_text(encoding='utf8')+'<noscript>')
html = html.replace('<script src="viewer.js"></script>', '<script src="viewer.js"></script><script src="desktop.js"></script><script src="map-header.js"></script><script src="recognition-screen.js"></script><script src="recognition.js"></script><script src="manual-map-core.js"></script><script src="manual-map.js"></script>')
html = html.replace('，或直接開啟 candidates.csv 檢視點位', '')
overlay_html = html.replace('<body class="desktop-app">', '<body class="desktop-app compact overlay">')
overlay_html = overlay_html.replace('<html lang="zh-Hant">', '<html lang="zh-Hant" class="overlay-root">')
overlay_html = overlay_html.replace('<title>伊莫地城地圖 · 可攜版</title>', '<title>伊莫地圖 · 覆蓋視窗</title>')
overlay_html = overlay_html.replace('<div class="tools"><button id="recognition-button"',
    '<div class="tools"><label id="overlay-size-control" for="overlay-size" title="以左下角為錨點調整覆蓋地圖大小">大小 <input type="range" id="overlay-size" min="50" max="150" step="10" value="100" aria-label="覆蓋地圖大小" aria-valuetext="100%"></label><button id="recognition-button"')
overlay_html = overlay_html.replace('<span id="live-status" role="status"></span>', '', 1)
overlay_html = overlay_html.replace('<button id="tracking-button" class="live-switch" role="switch" aria-checked="false">追蹤：關</button>', '<button id="tracking-button" class="live-switch" role="switch" aria-checked="false">追蹤：關</button><span id="live-status" role="status"></span>')
overlay_html = overlay_html.replace('<button id="zoom-in" aria-label="放大地圖">＋</button>', '<button id="zoom-in" aria-label="放大地圖">＋</button><button id="overlay-close" title="關閉覆蓋地圖，保留主視窗" aria-label="關閉覆蓋地圖">×</button>')
overlay_html = overlay_html.replace('<button id="overlay-close"', '<button id="overlay-drag" title="拖曳移動覆蓋地圖" aria-label="拖曳移動覆蓋地圖">⠿</button><button id="overlay-close"')
overlay_html = overlay_html.replace('<script src="desktop.js"></script><script src="map-header.js"></script><script src="recognition-screen.js"></script><script src="recognition.js"></script>', '<script src="overlay.js"></script>')
main_html = html.replace('<button id="compact" aria-pressed="false">地圖模式</button>', '''<button id="compact" aria-pressed="false">地圖模式</button><label id="main-overlay-size-control" for="main-overlay-size" title="調整覆蓋地圖視窗大小">覆蓋大小 <input type="range" id="main-overlay-size" min="50" max="150" step="10" value="100" aria-label="覆蓋地圖大小" aria-valuetext="100%"><output id="main-overlay-size-value" for="main-overlay-size">100%</output></label><button id="main-overlay-size-reset" type="button" title="將覆蓋地圖大小重置為 100%">重置大小</button>''')
main_html = main_html.replace('<button id="zoom-out" aria-label="縮小地圖">−</button>', '', 1)
main_html = main_html.replace('<button id="zoom-in" aria-label="放大地圖">＋</button>', '', 1)
(OUTPUT/'index.html').write_text(main_html, encoding='utf8')
(OUTPUT/'overlay.html').write_text(overlay_html, encoding='utf8')

stage_app_icons(OUTPUT)
stage_i18n(OUTPUT)
stage_loot_ranking(OUTPUT)
inventory = {str(p.relative_to(OUTPUT)).replace('\\','/'): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in OUTPUT.rglob('*') if p.is_file()}
(ROOT/'app/asset-manifest.json').write_text(json.dumps(dict(maps=len(maps), candidates=sum(len(m['pins']) for m in maps),
    files=inventory), indent=2), encoding='utf8')
print(f'Staged {len(maps)} dungeon maps, {sum(len(m["pins"]) for m in maps)} candidates, {len(inventory)} files')
