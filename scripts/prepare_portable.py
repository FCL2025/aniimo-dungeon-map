"""Stage only dungeon viewer assets for the Tauri executable; no game reads required."""
import hashlib
import json
import math
from pathlib import Path
import shutil
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT/'app/frontend'
VERSION = json.loads((ROOT/'app/src-tauri/tauri.conf.json').read_text(encoding='utf8'))['version']
OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT/'maps').mkdir(exist_ok=True)
source = ROOT/'exports/grab-eggs-data'
policy = json.loads((source/'display-policy.json').read_text(encoding='utf8'))['scope']
assert policy['kind'] == 'dungeon' and policy['loadLayerTextures'] is False
assert policy['monsterTypeIds'] == [11001200090]
allowed = set(policy['sceneIds'])
maps = []
pin_keys = ('id', 'category', 'name', 'iconKey', 'roomId', 'sourceId', 'sandboxConfigType', 'sandboxLevel',
            'difficultyCandidates', 'world', 'pixel', 'provenance', 'quality', 'graphId', 'isBoss')
for mid in sorted(allowed):
    original = json.loads((source/'maps'/f'{mid}.json').read_text(encoding='utf8'))
    record = {k: original[k] for k in ('id', 'size', 'bounds')}
    record['image'] = f'maps/{mid}.png'
    record['pins'] = [{k: p[k] for k in pin_keys if k in p} for p in original['pins']]
    maps.append(record)
    shutil.copyfile(ROOT/'exports/grab-eggs-dungeons/preview'/f'UI_Img_Map_{mid}.png', OUTPUT/record['image'])
difficulty = json.loads((source/'difficulty.json').read_text(encoding='utf8'))
validation = json.loads((source/'validation.json').read_text(encoding='utf8'))
from parse_dungeon_data import CATEGORIES
from extract_marker_icons import viewer_icons
icon_catalog = json.loads((source/'marker-icons.json').read_text(encoding='utf8'))
(OUTPUT/'icons').mkdir(exist_ok=True)
for asset in icon_catalog['assets'].values():
    icon = source/asset['image']
    assert hashlib.sha256(icon.read_bytes()).hexdigest() == asset['sha256']
    shutil.copyfile(icon, OUTPUT/asset['image'])
assert all(p['iconKey'] in icon_catalog['assets'] for m in maps for p in m['pins'])
data = dict(categories=CATEGORIES, icons=viewer_icons(icon_catalog), difficulties=difficulty['difficulties'], rewardRules=difficulty['rewardRules'],
            maps=maps, validation={'missingReferences': validation['missingReferences']}, scope=policy)
(OUTPUT/'data.js').write_text('window.DUNGEON_DATA='+json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')+';', encoding='utf8')
for name in ('viewer.js', 'viewer.css'):
    shutil.copyfile(ROOT/'scripts/data_viewer'/name, OUTPUT/name)
viewer_js = (OUTPUT/'viewer.js').read_text(encoding='utf8').replace(
    '找不到底圖，請保留 grab-eggs-dungeons 與本資料夾的相對位置。',
    '內嵌底圖載入失敗，請重新解壓應用並確認檔案完整。')
(OUTPUT/'viewer.js').write_text(viewer_js, encoding='utf8')
for name in ('desktop.js', 'desktop.css', 'recognition.js', 'recognition.css', 'recognition-worker.js', 'recognition-core.js', 'map-header.js', 'recognition-screen.js'):
    shutil.copyfile(ROOT/'app'/name, OUTPUT/name)
shutil.copytree(ROOT/'app/vendor', OUTPUT/'vendor', dirs_exist_ok=True)
html = (ROOT/'scripts/data_viewer/index.html').read_text(encoding='utf8')
html = html.replace('<title>搶蛋地圖 · 點位解析</title>', '<title>伊莫地城地圖 · 可攜版</title>')
html = html.replace('<body>', '<body class="desktop-app">')
html = html.replace('<link rel="stylesheet" href="viewer.css">', '<link rel="stylesheet" href="viewer.css"><link rel="stylesheet" href="desktop.css"><link rel="stylesheet" href="recognition.css">')
html = html.replace('<h1>地宮點位解析</h1>', '<h1>地城地圖</h1>')
start = html.index('<details><summary>資料與限制</summary>')
end = html.index('</details>', start) + len('</details>')
html = html[:start]+'''<details><summary>資料與限制</summary><p>可手動選圖，或使用測試版畫面辨識。迷霧與相似房間可能無法判定；候選點不代表當場一定出現。</p><p id="gaps"></p></details>'''+html[end:]
html = html.replace('資源版本 3595896 · 本機資料', f'可攜版 {VERSION} · 資源 3595896')
html = html.replace('<div class="tools">', '<div class="tools"><button id="recognition-button" role="switch" aria-checked="false">辨識：關</button><button id="new-session">新一場</button><button id="topmost" aria-pressed="true">置頂：開</button><button id="compact" aria-pressed="false">地圖模式</button><button id="help-button">說明</button>')
html = html.replace('<div class="stage">', '<p id="app-status" role="status"></p><p id="live-status" role="status"></p><div class="stage">')
html = html.replace('<fieldset>', (ROOT/'app/recognition.html').read_text(encoding='utf8')+'<fieldset>', 1)
html = html.replace('<noscript>', f'''<dialog id="help-dialog"><h2>伊莫地城地圖 · 可攜版 {VERSION}</h2>
<p>選擇地圖、惡夢或混沌難度，再勾選想看的候選點。怪物只收錄首領級幽黯星法師。</p>
<p>地圖以地宮編號識別。標記使用遊戲原始圖示；陶罐與其他搜刮點依遊戲設定共用寶箱圖示，首領使用星法師肖像。</p>
<p>「置頂」讓視窗顯示於一般視窗上方；「地圖模式」收合面板，適合放在遊戲旁。可拖曳標題列、調整視窗大小，並用滾輪縮放地圖。</p>
<p>遊戲建議使用無邊框視窗或視窗模式；獨佔全螢幕下的覆蓋尚未驗證。</p>
<p>「辨識」是工具列開關，開啟即自動連接伊莫，不開彈窗。未鎖定時跟隨當前第一名預覽，達 200 個吻合點（含）即固定本場。按「新一場」解除；關閉再開辨識會保留本場鎖定。側欄「辨識設定與候選」可匯入截圖或調整擷取範圍。</p>
<p>遊戲在前景時按 M，會短暫加強取樣 2.4 秒、最多每秒 5 張；平常未鎖定時約每秒 1 張。重複畫面會略過，鎖定後只追蹤該地宮的位置。M 按鍵只用來觸發取樣，仍會檢查畫面是否為地圖。</p>
<p>位置與軌跡由小地圖中心估計，定位中斷時顯示最後位置。此功能是測試版，已驗證一組真實迷霧截圖，仍待更多地宮、縮放與實際移動場景驗證；不辨識樓層，也不判定寶箱是否已取得。虛線外圈為房間模組補充點。</p>
<p>資料與 31 張單張地城底圖已內嵌。篩選設定與 WebView2 快取存於 EXE 旁的 Data 資料夾。需 Windows 10/11 x64 與 Microsoft Edge WebView2 Runtime。</p>
<button id="close-help">關閉</button></dialog><noscript>''')
html = html.replace('<script src="viewer.js"></script>', '<script src="viewer.js"></script><script src="desktop.js"></script><script src="map-header.js"></script><script src="recognition-screen.js"></script><script src="recognition.js"></script>')
html = html.replace('，或直接開啟 candidates.csv 檢視點位', '')
(OUTPUT/'index.html').write_text(html, encoding='utf8')

# Small geometric application icon, using the viewer's map/marker palette.
icons = ROOT/'app/src-tauri/icons'
icons.mkdir(exist_ok=True)
im = Image.new('RGBA', (256, 256), '#203542')
d = ImageDraw.Draw(im)
d.rounded_rectangle((28, 38, 228, 218), radius=18, fill='#bcb4a6', outline='#79cabe', width=8)
d.line((70, 48, 70, 207), fill='#203542', width=10)
d.line((80, 157, 218, 157), fill='#203542', width=10)
points = [(154+math.cos(-math.pi/2+i*math.pi/5)*(58 if i%2==0 else 25),
           100+math.sin(-math.pi/2+i*math.pi/5)*(58 if i%2==0 else 25)) for i in range(10)]
d.polygon(points, fill='#87dcff', outline='#203542', width=5)
im.save(icons/'icon.png')
im.save(icons/'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
inventory = {str(p.relative_to(OUTPUT)).replace('\\','/'): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in OUTPUT.rglob('*') if p.is_file()}
(ROOT/'app/asset-manifest.json').write_text(json.dumps(dict(maps=len(maps), candidates=sum(len(m['pins']) for m in maps),
    files=inventory), indent=2), encoding='utf8')
print(f'Staged {len(maps)} dungeon maps, {sum(len(m["pins"]) for m in maps)} candidates, {len(inventory)} files')
