"""Stage only dungeon viewer assets for the Tauri executable; no game reads required."""
import hashlib
import json
from pathlib import Path
import shutil
from app_icons import stage_app_icons
from build_viewer import CATEGORIES, display_pins, display_icons

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
            'difficultyCandidates', 'world', 'pixel', 'provenance', 'quality', 'graphId', 'isBoss', 'typeId', 'originalName')
for mid in sorted(allowed):
    original = json.loads((source/'maps'/f'{mid}.json').read_text(encoding='utf8'))
    record = {k: original[k] for k in ('id', 'size', 'bounds')}
    record['image'] = f'maps/{mid}.png'
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
for name in ('desktop.js', 'overlay.js', 'desktop.css', 'recognition.js', 'recognition.css', 'recognition-worker.js', 'recognition-core.js', 'recognition-vision.js', 'tracking-core.js', 'tracking-worker.js', 'map-header.js', 'recognition-screen.js'):
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
html = html[:start]+'''<details><summary>資料與限制</summary><p>可手動選圖，或使用測試版畫面辨識。迷霧與相似房間可能無法判定；候選點不代表當場一定出現。</p><p id="gaps"></p></details>'''+html[end:]
html = html.replace('資源版本 3595896 · 本機資料', f'可攜版 {VERSION} · 資源 3595896')
html = html.replace('<div><span class="eyebrow" id="map-id"></span><h2 id="map-title"></h2></div>', '''<div class="mapbar-start"><button id="sidebar-toggle" aria-expanded="true" aria-controls="sidebar" aria-label="收合側欄" title="收合側欄"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path class="sidebar-arrow" d="m16 9-3 3 3 3"/></svg></button><div class="map-heading"><span class="eyebrow" id="map-id"></span><div class="session-heading"><h2 id="map-title" title="覆蓋模式可拖曳此處移動視窗"></h2><span id="live-status" role="status"></span></div></div></div>''')
html = html.replace('<div class="tools">', '<div class="tools"><button id="recognition-button" class="live-switch" role="switch" aria-checked="false">辨識：關</button><button id="tracking-button" class="live-switch" role="switch" aria-checked="false">追蹤：關</button><button id="topmost" aria-pressed="true">置頂：開</button><button id="compact" aria-pressed="false">地圖模式</button>')
html = html.replace('<button id="zoom-in" aria-label="放大地圖">＋</button>', '''<button id="zoom-in" aria-label="放大地圖">＋</button><div class="app-menu"><button id="menu-button" aria-expanded="false" aria-controls="menu-panel">選單 <span aria-hidden="true">▾</span></button><div id="menu-panel" hidden><a id="discord-link" href="https://discord.gg/Yh235uyafn" target="_blank" rel="noopener noreferrer" title="在瀏覽器開啟搶蛋 Discord">加入搶蛋 Discord <span aria-hidden="true">↗</span></a><button id="help-button">說明</button></div></div>''')
notice_start = html.index('  <p class="notice">')
notice_end = html.index('</p>', notice_start) + len('</p>')
notice = html[notice_start:notice_end]
html = html[:notice_start] + html[notice_end:]
html = html.replace('<div class="stage">', '<div class="stage">' + notice + '<p id="app-status" role="status" hidden></p><div class="player-tools"><span id="player-status" class="sr-only" role="status">等待人物定位</span><button id="locate-player" title="置中到人物位置" aria-label="置中到人物位置" hidden disabled>◎</button></div>')
html = html.replace('<fieldset>', (ROOT/'app/recognition.html').read_text(encoding='utf8')+'<fieldset>', 1)
html = html.replace('<noscript>', f'''<dialog id="help-dialog"><h2>伊莫地城地圖 · 可攜版 {VERSION}</h2>
<p>選擇地圖、惡夢或混沌難度，再勾選想看的候選點。怪物只收錄首領級幽黯星法師。</p>
<p>寶箱分為金色與琉璃，可分別勾選。滑鼠停在地圖或難度選單上可用滾輪切換；側欄「圖示大小」可調整至 75–250%，會自動保存並同步到覆蓋地圖。</p>
<p>左上角側欄圖示可切換左側資訊，滑鼠停留可查看「收合側欄／展開側欄」提示。視窗尺寸不變，地圖會符合剩餘空間，並記住收合狀態。右上角「選單」可加入搶蛋 Discord 或開啟本說明。</p>
<p>地圖以地宮編號識別。標記使用遊戲原始圖示，首領使用星法師肖像。</p>
<p>「置頂」調整主視窗。只有按「地圖模式」才會開啟獨立的覆蓋地圖，主視窗會保留，可繼續調整篩選或最小化。再按「地圖模式」，或按覆蓋地圖右上 ×，即可關閉覆蓋地圖；關閉主視窗則一起結束。</p>
<p>開啟地圖模式後，按 F1 暫時隱藏覆蓋地圖，再按 F1 恢復。遊戲在前景、主視窗最小化時也能使用；隱藏時可點擊下方遊戲，位置、縮放、篩選與追蹤狀態均保留。長按只切換一次。完全關閉地圖模式後會釋放 F1，重新開啟先按「地圖模式」。若 F1 被其他程式占用，工具會提示，仍可用原本按鈕關閉地圖。</p>
<p>覆蓋地圖是 448 × 464 像素的透明無邊框視窗，背景與工具列不再鋪底色；1920 × 1080 遊戲畫面預設放在左側 (4, 496)。會持續跟隨遊戲視窗移動，遊戲最小化時隱藏、還原後跟回。拖曳地宮編號可調整相對位置，遊戲移動後仍保留；縮小遊戲時會限制在視窗內。尚未開啟遊戲時先放在螢幕左側，找到遊戲後自動跟隨。</p>
<p>滾輪縮放、拖曳地圖平移。遊戲鎖住滑鼠時先按 Alt 顯示游標，再操作覆蓋地圖。兩個視窗同步地圖、篩選與人物位置，以及辨識／追蹤開關；取得人物位置後才顯示 ◎ 置中按鈕。</p>
<p>主視窗工具列不顯示模式名稱、地宮編號與本場狀態，可在側欄選圖及查看辨識結果。覆蓋地圖仍顯示可拖曳的地宮編號與本場狀態。一般提示顯示 5 秒後消失。候選位置不代表當場一定出現；切換難度會篩選蛋巢及其中的怪物模組，其他點位保留各候選群組。</p>
<p>遊戲建議使用無邊框視窗或視窗模式；獨佔全螢幕下的覆蓋尚未驗證。</p>
<p>「辨識」是工具列開關，開啟即自動連接伊莫，不開彈窗。未鎖定時跟隨當前第一名預覽，達 200 個吻合點（含）即固定本場。每次重新開啟辨識都會清除上一場鎖定與舊候選，重新讀取本場。側欄「辨識、追蹤設定與候選」可匯入截圖或調整擷取範圍。</p>
<p>遊戲在前景時按 M，會短暫加強取樣 2.4 秒、最多每秒 5 張；平常未鎖定時約每秒 1 張。重複畫面會略過，鎖定後只追蹤該地宮的位置。M 按鍵只用來觸發取樣，仍會檢查畫面是否為地圖。</p>
<p>「辨識」只負責判斷地宮，「追蹤」獨立判斷小地圖上的人物位置。找到正確地宮後可關閉辨識、開啟追蹤，也可手動選圖後直接追蹤。只載入目前地圖，優先處理最新畫面；僅追蹤時先裁切小地圖與 M 地圖標題區再編碼，最高每秒取樣 10 張。實際更新速度取決於畫面與電腦效能。</p>
<p>人物位置使用深色底盤、青綠圓圈與實心圓點，搭配金色漣漪，顯示在寶箱等圖示上方。按 ◎ 置中人物；1.5 秒無法取得新位置時停止漣漪，改成灰色空心圈保留最後位置。關閉追蹤會清除人物標記；重新開啟辨識會清除舊位置，追蹤開關保持獨立。系統設定減少動畫時只顯示靜態人物圓圈。迷霧、相似房間或範圍未對準時可能無法定位；不辨識樓層，也不判定寶箱是否已取得。虛線外圈為房間模組補充點。</p>
<p>資料與 31 張單張地城底圖已內嵌。篩選設定會自動保存，同一個 Windows 帳號更新版本或移動應用資料夾後仍會沿用。首次升級請先關閉舊版，並將新版放在舊版旁邊，以便自動匯入設定。需 Windows 10/11 x64 與 Microsoft Edge WebView2 Runtime。</p>
<button id="close-help">關閉</button></dialog><noscript>''')
html = html.replace('<script src="viewer.js"></script>', '<script src="viewer.js"></script><script src="desktop.js"></script><script src="map-header.js"></script><script src="recognition-screen.js"></script><script src="recognition.js"></script>')
html = html.replace('，或直接開啟 candidates.csv 檢視點位', '')
(OUTPUT/'index.html').write_text(html, encoding='utf8')
overlay_html = html.replace('<body class="desktop-app">', '<body class="desktop-app compact overlay">')
overlay_html = overlay_html.replace('<html lang="zh-Hant">', '<html lang="zh-Hant" class="overlay-root">')
overlay_html = overlay_html.replace('<title>伊莫地城地圖 · 可攜版</title>', '<title>伊莫地圖 · 覆蓋視窗</title>')
overlay_html = overlay_html.replace('<button id="zoom-in" aria-label="放大地圖">＋</button>', '<button id="zoom-in" aria-label="放大地圖">＋</button><button id="overlay-close" title="關閉覆蓋地圖，保留主視窗" aria-label="關閉覆蓋地圖">×</button>')
overlay_html = overlay_html.replace('<script src="desktop.js"></script><script src="map-header.js"></script><script src="recognition-screen.js"></script><script src="recognition.js"></script>', '<script src="overlay.js"></script>')
(OUTPUT/'overlay.html').write_text(overlay_html, encoding='utf8')

stage_app_icons(OUTPUT)
inventory = {str(p.relative_to(OUTPUT)).replace('\\','/'): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in OUTPUT.rglob('*') if p.is_file()}
(ROOT/'app/asset-manifest.json').write_text(json.dumps(dict(maps=len(maps), candidates=sum(len(m['pins']) for m in maps),
    files=inventory), indent=2), encoding='utf8')
print(f'Staged {len(maps)} dungeon maps, {sum(len(m["pins"]) for m in maps)} candidates, {len(inventory)} files')
