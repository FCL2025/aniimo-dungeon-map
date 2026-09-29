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
parser.add_argument('--output-dir', type=Path, help='Stage in another directory inside the project, e.g. when the default EXE is running.')
args = parser.parse_args()
VERSION = json.loads((ROOT/'app/src-tauri/tauri.conf.json').read_text(encoding='utf8'))['version']
NAME = f'AniimoDungeonMap-{VERSION}-windows-x64-portable'
DIST = ROOT/'dist'
folder = args.output_dir.resolve() if args.output_dir else DIST/NAME
if not folder.is_relative_to(ROOT):
    parser.error('--output-dir must be inside the project')
folder.mkdir(parents=True, exist_ok=True)
binary = ROOT/'app/src-tauri/target/x86_64-pc-windows-msvc/release/aniimo-dungeon-map.exe'
if not binary.is_file():
    raise SystemExit('Build the release executable first')
shutil.copyfile(binary, folder/'AniimoDungeonMap.exe')
readme = rf'''伊莫地城地圖　可攜版 {VERSION}

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
- 主視窗工具列「Discord」可加入搶蛋 Discord；側欄底部「說明」可查看操作方式。
- 左上角側欄圖示切換左側資訊，滑鼠停留可查看「收合側欄／展開側欄」提示；視窗尺寸不變，地圖會符合剩餘空間，並保存收合狀態。
- 手動選擇地城地圖與惡夢／混沌難度；滑鼠停在選單上，可用滾輪切換。
- 金色寶箱與琉璃寶箱分開勾選，不再顯示低階寶箱、藍色或紫色鑰匙。
- 側欄「圖示大小」預設為 150%，可調整至 75–250%，會自動保存並同步到覆蓋地圖；鑰匙標記另外放大 50%。
- 工具列「辨識」開關：開啟即自動連接伊莫，無需彈窗；在遊戲中按 M 即可。
- 自動選取伊莫遊戲主畫面，排除同一程序的其他介面視窗；若提示找不到主視窗，請先進入遊戲再開啟辨識。
- 使用預設拉到最遠的 M 地圖時，先按正門／側門距離與方向縮小候選，再比對地形；線索不足時自動放寬搜尋。
- 只辨識惡夢／混沌地圖池的 7 張地宮：20032、20034、20035、20036、20037、20039、20040。
- 加入 20032、20034、20035、20037、20040 的初始迷霧參考地形；正門被人物遮住時，以入口周圍地形與側門位置交叉確認候選，並依畫面尺寸換算參考比例。線索不足時沿用完整搜尋。
- 未鎖定時隨當前第一名預覽，達到 200 個吻合點（含）即鎖定，本場不再換圖。
- 每次重新開啟辨識都會清除舊鎖定、候選與人物位置，重新判斷本場。側欄可匯入截圖。
- 按 M 後短暫加強取樣 2.4 秒、最多每秒 5 張；重複畫面會略過，待比對最多保留 3 張。
- 側欄最下方的 DEBUG LOG 預設關閉；開啟後，辨識超過 5 秒仍未鎖定才會寫入診斷 log，並在辨識設定顯示路徑。關閉後停止新增紀錄，既有檔案保留；檔案位於 %LOCALAPPDATA%\local.aniimo.dungeonmap\logs\recognition.log，不保存截圖。
- 換地宮時將辨識關閉再開啟即可；追蹤開關保持獨立。擷取不會隨程式啟動自動開啟。
- 「辨識」只判斷地宮；選對地圖後可關閉辨識，再用獨立「追蹤」開關估計人物位置。
- 可手動選圖後直接開追蹤；兩者共用一個擷取連線，關閉其中一項不會停止另一項。
- 追蹤只載入目前地圖，僅追蹤時裁切小地圖區域，最高每秒取樣 10 張；不排隊處理舊位置。
- 若預覽中的青色框未對準小地圖，可選「框選小地圖」拖曳調整。
- 可篩選寶箱、蛋巢、鑰匙等；怪物僅首領級幽黯星法師。陶罐與其他搜刮點不再顯示。
- 地圖以地宮編號識別，不使用參考圖片的檔名或括號描述。
- 使用遊戲原始圖示，首領使用星法師肖像。
- 置頂：切換是否顯示於一般視窗上方。
- 地圖模式：按下才開啟獨立的覆蓋地圖；原主視窗保留，可繼續操作或最小化。
- 主視窗「覆蓋大小」滑桿可即時調整覆蓋視窗至 50–150%，「重置大小」恢復 100%；覆蓋視窗上的大小滑桿在放開後套用，避免拖拉時視窗反覆跳動。大小會保存並同步。
- 地圖模式開啟後，F1 可隱藏／恢復覆蓋地圖；遊戲在前景或主視窗最小化時也有效。
- 隱藏時可點擊下方遊戲，位置、縮放、篩選和追蹤繼續保留；長按 F1 只切換一次。
- 完全關閉地圖模式會釋放 F1；若按鍵被其他程式占用會顯示提示，仍能用地圖模式按鈕或 × 關閉。
- 覆蓋地圖為無邊框正方形置頂視窗；1920 × 1080 時為 590 × 590，2560 × 1440 時為 790 × 790，自動依遊戲視窗大小切換並放在左下。
- 覆蓋地圖背景、工具列與按鈕皆透明，持續跟隨遊戲視窗移動；遊戲最小化／關閉時隱藏，還原／重開後跟回。
- 拖曳上方移動圖示可調整相對位置，遊戲移動後仍保留；遊戲視窗縮小時會限制在可用範圍內。
- 覆蓋地圖可滾輪縮放、拖曳地圖平移；主視窗的符合視窗按鈕保留，原本的 −／＋ 按鈕已移除。兩個視窗同步篩選與人物位置。
- 再按主視窗「地圖模式」或覆蓋地圖右上 × 可以關閉覆蓋地圖；關閉主視窗會一起結束。
- 遊戲鎖住滑鼠時先按 Alt 顯示游標，再操作覆蓋地圖；覆蓋區域會接收滑鼠操作。
- 主視窗工具列不顯示模式名稱、地宮編號與本場狀態；可在側欄選圖及查看辨識結果，覆蓋地圖右上顯示放大的辨識與追蹤按鈕，不顯示「手動選圖」狀態文字與地宮編號。
- 長提示顯示 5 秒後自動消失，不佔地圖空間；底部不再顯示文字說明與標記清單。
- 開啟「追蹤」後，回到遊戲畫面可估計人物位置；人物使用薄荷綠圓點與金色漣漪，顯示於寶箱等圖示上方。主視窗右下 ◎ 可置中人物，覆蓋地圖不顯示此按鈕。
- 1.5 秒未取得新位置時改成灰色空心圈保留最後位置。
- 尚未取得人物位置時隱藏主視窗 ◎；人物更新重用底圖與標記快取。
- 拖曳標題列移動視窗，拖曳地圖平移，滾輪縮放。
- 建議遊戲使用無邊框視窗或視窗模式；獨佔全螢幕覆蓋尚未驗證。

這一版的範圍
- 7 張惡夢／混沌候選地城、單張底圖；不載入外部地圖或第二層貼圖。
- 標記是候選點，不代表當場必定生成。「顯示房間模組補充點」預設開啟；虛線外圈代表同房間模板推論的候選位置，包含星法師首領。關閉後只顯示地圖直接引用的候選點。
- 地圖辨識已驗證 20032、20034、20035、20037、20040 的真實初始迷霧截圖；其他解析度以縮放模擬測試，更多地宮與連續遊玩仍待實機驗證。人物追蹤的測試範圍未因此擴大。
- 不判定物件是否已生成／搜刮，不提供樓層辨識或滑鼠穿透。
- 即時擷取使用 Windows Graphics Capture，需要 Windows 10 1903 以上；遊戲最小化時暫停辨識。
- 畫面只在本機記憶體處理，不上傳、不自動保存影片或截圖，不讀取遊戲記憶體。
- 遊戲資料來源版本：3595896。

設定保存與更新
篩選、難度、圖示大小、側欄收合、置頂與擷取範圍會自動保存。
覆蓋地圖僅在按下「地圖模式」時開啟，啟動程式不會自動顯示。
0.2.3 起統一存在 %LOCALAPPDATA%\local.aniimo.dungeonmap\WebView2。
同一個 Windows 帳號更新版本、換資料夾或刪除舊版，仍會沿用設定。
首次升級請先關閉舊版，再啟動新版。新版會優先匯入自身旁的舊 Data，
否則從同層 AniimoDungeonMap-*-windows-x64-portable 資料夾匯入最近使用的設定。
若舊版在不同位置，可先將舊版 Data 複製到新版 EXE 旁，再首次啟動。
匯入不會修改舊 Data；已有共用設定時不再匯入，避免被舊設定覆蓋。
移到另一台電腦時，關閉所有版本後複製上述 local.aniimo.dungeonmap 資料夾
到新電腦的 %LOCALAPPDATA%；新電腦仍需有 WebView2 Runtime。
移除應用資料夾會保留設定；要完整移除，關閉所有版本後再刪除上述共用資料夾。
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
              requiresWebView2=True,
              embeddedMaps=json.loads((ROOT/'app/asset-manifest.json').read_text(encoding='utf8'))['maps'],
              difficultyIds=[5,6], monsterTypeIds=[11001200090])
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
