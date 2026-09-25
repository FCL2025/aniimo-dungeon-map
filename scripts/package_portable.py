"""Stage a local runnable release; create a ZIP only when explicitly requested."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--zip', action='store_true', help='Also create a distributable ZIP (opt-in).')
args = parser.parse_args()
VERSION = json.loads((ROOT/'app/src-tauri/tauri.conf.json').read_text(encoding='utf8'))['version']
NAME = f'AniimoDungeonMap-{VERSION}-windows-x64-portable'
DIST = ROOT/'dist'
folder = DIST/NAME
folder.mkdir(parents=True, exist_ok=True)
binary = ROOT/'app/src-tauri/target/x86_64-pc-windows-msvc/release/aniimo-dungeon-map.exe'
if not binary.is_file():
    raise SystemExit('Build the release executable first')
shutil.copyfile(binary, folder/'AniimoDungeonMap.exe')
readme = f'''伊莫地城地圖　可攜版 {VERSION}

啟動
1. 將應用資料夾放在一般可寫入位置；若使用 ZIP，請先完整解壓。
2. 執行 AniimoDungeonMap.exe，不需安裝本應用，不需系統管理員權限。
3. 不需要 Python、Node.js、Rust 或遊戲檔案；地圖與點位已內嵌。

系統需求
- Windows 10/11，64 位元 x64。
- Microsoft Edge WebView2 Runtime。
  本可攜包使用電腦已有的 Runtime，沒有把整套瀏覽器放進 ZIP。
  若另一台電腦缺少 Runtime，請從 Microsoft 官方安裝 Evergreen Runtime：
  https://developer.microsoft.com/microsoft-edge/webview2/

使用
- 手動選擇地城地圖與惡夢／混沌難度。
- 工具列「辨識」開關：開啟即自動連接伊莫，無需彈窗；在遊戲中按 M 即可。
- 未鎖定時隨當前第一名預覽，達到 200 個吻合點（含）即鎖定，本場不再換圖。
- 關閉再開辨識會保留鎖定；要重新排名請按「新一場」。側欄可展開設定、候選及截圖匯入。
- 按 M 後短暫加強取樣 2.4 秒、最多每秒 5 張；重複畫面會略過，待比對最多保留 3 張。
- 每次換地宮請按「新一場」，清除上一場線索與軌跡。擷取不會隨程式啟動自動開啟。
- 地宮確認後，嘗試以小地圖中心估計位置與軌跡；定位中斷會標記最後位置。
- 若預覽中的青色框未對準小地圖，可選「框選小地圖」拖曳調整。
- 可篩選寶箱、蛋巢、陶罐、鑰匙等；怪物僅首領級幽黯星法師。
- 地圖以地宮編號識別，不使用參考圖片的檔名或括號描述。
- 使用遊戲原始圖示；陶罐與其他搜刮點依遊戲設定共用寶箱圖示，首領使用星法師肖像。
- 置頂：切換是否顯示於一般視窗上方。
- 地圖模式：收合面板並縮小視窗；按「展開面板」返回。
- 拖曳標題列移動視窗，拖曳地圖平移，滾輪縮放。
- 建議遊戲使用無邊框視窗或視窗模式；獨佔全螢幕覆蓋尚未驗證。

這一版的範圍
- 31 張地城、單張底圖；不載入外部地圖或第二層貼圖。
- 標記是候選點，不代表當場必定生成；虛線外圈是房間模組補充點。
- 畫面辨識與定位為測試版：已驗證一組真實迷霧截圖，更多地宮、樓層、縮放及連續遊玩仍待驗證。
- 不判定物件是否已生成／搜刮，不提供樓層辨識或滑鼠穿透。
- 即時擷取使用 Windows Graphics Capture，需要 Windows 10 1903 以上；遊戲最小化時暫停辨識。
- 畫面只在本機記憶體處理，不上傳、不自動保存影片或截圖，不讀取遊戲記憶體。
- 遊戲資料來源版本：3595896。

可攜資料
首次啟動會在 EXE 旁建立 Data 資料夾，保存篩選設定與 WebView2 快取。
移到另一台電腦時一起複製 Data，可帶走設定；新電腦仍需有 WebView2 Runtime。
關閉應用後移除整個解壓資料夾即可移除本工具。
SHA256SUMS.txt 提供 EXE 與這份說明的檔案校驗值。
'''
(folder/'使用說明.txt').write_text(readme, encoding='utf-8-sig')
notices = '\n\n'.join((ROOT/'app/vendor'/name).read_text(encoding='utf8')
                       for name in ('OpenCV-LICENSE.txt', 'windows-capture-LICENSE.txt'))
(folder/'THIRD_PARTY_NOTICES.txt').write_text('OpenCV.js 4.13.0 (Apache-2.0) / windows-capture 2.0.1 (MIT)\n\n'+notices, encoding='utf8')
files = [folder/'AniimoDungeonMap.exe', folder/'使用說明.txt', folder/'THIRD_PARTY_NOTICES.txt']
checksums = ''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in files)
(folder/'SHA256SUMS.txt').write_text(checksums, encoding='utf8')
files.append(folder/'SHA256SUMS.txt')
report = dict(version=VERSION, executable=str(files[0].relative_to(ROOT)),
              exeBytes=files[0].stat().st_size, exeSha256=hashlib.sha256(files[0].read_bytes()).hexdigest(),
              archive=None,
              requiresWebView2=True, embeddedMaps=31, difficultyIds=[5,6], monsterTypeIds=[11001200090])
if args.zip:
    archive = DIST/f'{NAME}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        # Explicit inventory prevents packaging test profiles or personal settings.
        for path in files:
            z.write(path, f'{NAME}/{path.name}')
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert len(z.namelist()) == 4 and not any('/Data/' in n for n in z.namelist())
    report.update(archive=str(archive.relative_to(ROOT)), zipBytes=archive.stat().st_size,
                  zipSha256=hashlib.sha256(archive.read_bytes()).hexdigest())
(DIST/'portable-build.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(report, ensure_ascii=False, indent=2))
