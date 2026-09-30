"""Stage only dungeon viewer assets for the Tauri executable; no game reads required."""
import hashlib
import json
from pathlib import Path
import shutil
from app_icons import stage_app_icons
from build_viewer import CATEGORIES, active_map_ids, display_pins, display_icons
from analyze_portal_geometry import portal_geometry

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
pin_keys = ('id', 'category', 'name', 'iconKey', 'roomId', 'sourceId', 'sandboxConfigType', 'sandboxLevel',
            'difficultyCandidates', 'world', 'pixel', 'provenance', 'quality', 'graphId', 'isBoss', 'typeId', 'originalName')
for mid in sorted(allowed):
    original = json.loads((source/'maps'/f'{mid}.json').read_text(encoding='utf8'))
    record = {k: original[k] for k in ('id', 'size', 'bounds')}
    record['image'] = f'maps/{mid}.png'
    record['portalGeometry'] = portal_geometry(original, scenes[str(mid)]['mapImageScale'])
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
for name in ('viewer.js', 'viewer.css'):
    shutil.copyfile(ROOT/'scripts/data_viewer'/name, OUTPUT/name)
viewer_js = (OUTPUT/'viewer.js').read_text(encoding='utf8').replace(
    '找不到底圖，請保留 grab-eggs-dungeons 與本資料夾的相對位置。',
    '內嵌底圖載入失敗，請重新解壓應用並確認檔案完整。')
(OUTPUT/'viewer.js').write_text(viewer_js, encoding='utf8')
for name in ('desktop.js', 'overlay.js', 'desktop.css', 'recognition.js', 'recognition.css', 'recognition-worker.js', 'recognition-core.js', 'recognition-vision.js', 'recognition-portals.js', 'recognition-search.js', 'recognition-fog.js', 'fog-references.json', 'tracking-core.js', 'tracking-worker.js', 'map-header.js', 'recognition-screen.js'):
    shutil.copyfile(ROOT/'app'/name, OUTPUT/name)
shutil.copytree(ROOT/'app/vendor', OUTPUT/'vendor', dirs_exist_ok=True)
html = (ROOT/'scripts/data_viewer/index.html').read_text(encoding='utf8')
html = html.replace('<title>搶蛋地圖 · 點位解析</title>', '<title>伊莫地城地圖 · 可攜版</title>')
html = html.replace('<body>', '<body class="desktop-app">')
html = html.replace('<link rel="stylesheet" href="viewer.css">', '<link rel="stylesheet" href="viewer.css"><link rel="stylesheet" href="desktop.css"><link rel="stylesheet" href="recognition.css">')
html = html.replace('<h1>地宮點位解析</h1>', '<h1>地城地圖</h1>')
html = html.replace('<aside>', '<aside id="sidebar" aria-label="地圖與篩選設定">')
start = html.index('<details><summary>資料與限制</summary>')
end = html.index('</details>', start) + len('</details>')
html = html[:start]+'''<details><summary>資料與限制</summary><p>可手動選圖，或使用畫面辨識。迷霧與相似房間可能無法判定；候選點不代表當場一定出現。</p><p id="gaps"></p></details>'''+html[end:]
html = html.replace('資源版本 3595896 · 本機資料', f'可攜版 {VERSION} · 資源 3595896')
html = html.replace('<footer>', '''<button id="help-button" type="button">說明</button>
<label class="check debug-log-control" title="開啟後才寫入辨識診斷紀錄"><input type="checkbox" id="debug-log"><span>DEBUG LOG（辨識診斷）</span></label>
<footer>''', 1)
html = html.replace('<div><span class="eyebrow" id="map-id"></span><h2 id="map-title"></h2></div>', '''<div class="mapbar-start"><button id="sidebar-toggle" aria-expanded="true" aria-controls="sidebar" aria-label="收合側欄" title="收合側欄"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path class="sidebar-arrow" d="m16 9-3 3 3 3"/></svg></button><div class="map-heading"><span class="eyebrow" id="map-id"></span><div class="session-heading"><h2 id="map-title"></h2><span id="live-status" role="status"></span></div></div></div>''')
html = html.replace('<div class="tools">', '<div class="tools"><button id="recognition-button" class="live-switch" role="switch" aria-checked="false">辨識：關</button><button id="tracking-button" class="live-switch" role="switch" aria-checked="false">追蹤：關</button><button id="topmost" aria-pressed="true">置頂：開</button><button id="compact" aria-pressed="false">地圖模式</button>')
html = html.replace('<button id="zoom-in" aria-label="放大地圖">＋</button>', '''<button id="zoom-in" aria-label="放大地圖">＋</button><a id="discord-link" href="https://discord.gg/Yh235uyafn" target="_blank" rel="noopener noreferrer" title="在瀏覽器開啟搶蛋 Discord">Discord ↗</a>''')
notice_start = html.index('  <p class="notice">')
notice_end = html.index('</p>', notice_start) + len('</p>')
notice = html[notice_start:notice_end]
html = html[:notice_start] + html[notice_end:]
html = html.replace('<div class="stage">', '<div class="stage">' + notice + '<p id="app-status" role="status" hidden></p><div class="player-tools"><span id="player-status" class="sr-only" role="status">等待人物定位</span><button id="locate-player" title="置中到人物位置" aria-label="置中到人物位置" hidden disabled>◎</button></div>')
html = html.replace('<fieldset>', (ROOT/'app/recognition.html').read_text(encoding='utf8')+'<fieldset>', 1)
html = html.replace('<noscript>', f'''<dialog id="help-dialog"><h2>伊莫地城地圖 · 可攜版 {VERSION}</h2>
<p>選擇地圖、惡夢或混沌難度，再勾選想看的候選點。怪物只收錄首領級幽黯星法師。</p>
<p>寶箱分為金色與琉璃，可分別勾選。滑鼠停在地圖或難度選單上可用滾輪切換；側欄「圖示大小」可調整至 75–250%，會自動保存並同步到覆蓋地圖。</p>
<p>左上角側欄圖示可切換左側資訊，滑鼠停留可查看「收合側欄／展開側欄」提示。視窗尺寸不變，地圖會符合剩餘空間，並記住收合狀態。主視窗工具列可開啟搶蛋 Discord，側欄底部可開啟說明。</p>
<p>地圖以地宮編號識別。標記使用遊戲原始圖示，首領使用星法師肖像。</p>
<p>「置頂」調整主視窗。只有按「地圖模式」才會開啟獨立的覆蓋地圖，主視窗會保留，可繼續調整篩選或最小化。再按「地圖模式」，或按覆蓋地圖右上 ×，即可關閉覆蓋地圖；關閉主視窗則一起結束。</p>
<p>開啟地圖模式後，按 F1 暫時隱藏覆蓋地圖，再按 F1 恢復。遊戲在前景、主視窗最小化時也能使用；隱藏時可點擊下方遊戲，位置、縮放、篩選與追蹤狀態均保留。長按只切換一次。完全關閉地圖模式後會釋放 F1，重新開啟先按「地圖模式」。若 F1 被其他程式占用，工具會提示，仍可用原本按鈕關閉地圖。</p>
<p>覆蓋地圖是透明正方形視窗；1920 × 1080 遊戲畫面預設為 590 × 590 像素，2560 × 1440 自動切換為 790 × 790 像素，放在遊戲畫面左下。會持續跟隨遊戲視窗移動，遊戲最小化時隱藏、還原後跟回。拖曳上方移動圖示可調整相對位置，遊戲移動後仍保留；縮小遊戲時會限制在視窗內。尚未開啟遊戲時先放在螢幕左側，找到遊戲後自動跟隨。</p>
<p>主視窗「覆蓋大小」可拖動調整至 50–150%，按「重置大小」回到 100%。覆蓋地圖上方的大小滑桿在放開後才調整視窗，避免滑桿跟著視窗移動。兩邊設定同步並保存。</p>
<p>滾輪縮放、拖曳地圖平移。遊戲鎖住滑鼠時先按 Alt 顯示游標，再操作覆蓋地圖。兩個視窗同步地圖、篩選與人物位置，以及辨識／追蹤開關。</p>
<p>覆蓋地圖右上方顯示辨識與追蹤開關，不顯示「手動選圖」狀態文字、地宮編號或右下角置中按鈕。一般提示顯示 5 秒後消失。候選位置不代表當場一定出現；切換難度會篩選蛋巢及其中的怪物模組，其他點位保留各候選群組。</p>
<p>遊戲建議使用無邊框視窗或視窗模式；獨佔全螢幕下的覆蓋尚未驗證。</p>
<p>「辨識」是工具列開關，開啟即自動連接伊莫，不開彈窗。確認地圖後立即鎖定並停止辨識，本場不再自動換圖。每次重新開啟辨識都會清除上一場鎖定與舊候選，重新讀取本場。側欄「辨識、追蹤設定與候選」可匯入截圖或調整擷取範圍。</p>
<p>遊戲在前景時按 M，會短暫加強取樣 2.4 秒、最多每秒 5 張；平常未鎖定時約每秒 1 張。重複畫面會略過，鎖定後只追蹤該地宮的位置。M 按鍵只用來觸發取樣，仍會檢查畫面是否為地圖。</p>
<p>使用預設拉到最遠的 M 地圖時，先按正門／側門距離與角度縮小候選，再以地形與門位交叉確認。正門被遮住時，可使用初始地形與側門位置確認；門位無法使用時，要求分布夠廣且明顯勝過其他候選的地形。線索不足時保留預覽，沒有固定 200 點限制。</p>
<p>「辨識」只負責判斷地宮，「追蹤」獨立判斷小地圖上的人物位置。找到正確地宮後可關閉辨識、開啟追蹤，也可手動選圖後直接追蹤。只載入目前地圖，優先處理最新畫面；僅追蹤時先裁切小地圖與 M 地圖標題區再編碼，最高每秒取樣 10 張。實際更新速度取決於畫面與電腦效能。</p>
<p>人物位置顯示為薄荷綠圓點與金色漣漪。主視窗按 ◎ 可置中人物；1.5 秒無法取得新位置時轉為灰色空心圈。關閉追蹤會清除人物標記；重新開啟辨識會清除舊位置，追蹤開關保持獨立。迷霧、相似房間或範圍未對準時可能無法定位；不辨識樓層，也不判定寶箱是否已取得。</p>
<p>惡夢與混沌地圖池的 7 張單張底圖已內嵌。「顯示房間模組補充點」預設開啟；虛線外圈是同房間模板推論的候選位置，關閉後只顯示地圖直接引用的點位。篩選設定會自動保存，同一個 Windows 帳號更新版本或移動應用資料夾後仍會沿用。首次升級請先關閉舊版，並將新版放在舊版旁邊，以便自動匯入設定。需 Windows 10/11 x64 與 Microsoft Edge WebView2 Runtime。</p>
<p>側欄最下方的 DEBUG LOG 預設關閉。需要排查辨識時再開啟；關閉後停止新增診斷紀錄，先前產生的檔案仍會保留。</p>
<button id="close-help">關閉</button></dialog><noscript>''')
html = html.replace('<script src="viewer.js"></script>', '<script src="viewer.js"></script><script src="desktop.js"></script><script src="map-header.js"></script><script src="recognition-screen.js"></script><script src="recognition.js"></script>')
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
inventory = {str(p.relative_to(OUTPUT)).replace('\\','/'): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in OUTPUT.rglob('*') if p.is_file()}
(ROOT/'app/asset-manifest.json').write_text(json.dumps(dict(maps=len(maps), candidates=sum(len(m['pins']) for m in maps),
    files=inventory), indent=2), encoding='utf8')
print(f'Staged {len(maps)} dungeon maps, {sum(len(m["pins"]) for m in maps)} candidates, {len(inventory)} files')
