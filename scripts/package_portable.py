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
1. 將 ZIP 完整解壓後執行 AniimoDungeonMap.exe；不需安裝本應用。
2. 需要 Windows 10/11 x64 與 Microsoft Edge WebView2 Runtime。
3. 地圖與點位已內嵌，執行時不需要 Python、Node.js、Rust 或遊戲檔案。

使用
- PVE 開啟「辨識」後在遊戲按 M，確認後自動選圖並鎖定。下一場關閉再開啟辨識；側欄可匯入截圖、選擇視窗與調整擷取範圍。支援 12 張地宮，每張都有遊戲資源合成的初始迷霧參考，以門位與起始房間地形交叉確認。若地圖已拉近、看不到側門或地形不足，請多探索後再按 M。
- 側欄可切換 PVE／PVP。PVE 可選地圖與惡夢／混沌難度，也可按「選擇出口」依遊戲 M 地圖的出口方向挑選。
- PVE 按「開始本局撤離提醒」，每 2 秒檢查繁中遊戲介面的左側條件；連續兩次確認「搭乘蛋船安全撤離」後播放一次內嵌音效並停止。再按可取消，下一局需手動重啟；與辨識、追蹤獨立運作。
- 選擇方向後，比對入口對齊、比例一致的「門位」圖，或切換「地形」，再點選符合的地圖。靠近邊界的相鄰方向也會列入候選；即使只有一張仍需點選確認。
- PVP 提供搶蛋大作戰的六張區域地圖，各區顯示脈源之繭、珍稀寶箱(金)、精緻遺跡寶箱 (紫) 及三色集結點的已核對候選標記。
- 勾選「顯示最佳路徑」後選路線 1 或 2；兩人使用相同補充點設定，各開自己編號的琉璃寶箱與鑰匙房。橙色虛線有鑰匙才走。
- 地圖標記是候選位置，並非當場一定生成。寶箱以原始圖示及金色／淺藍色外框區分，2F 表示依高度判斷的二樓寶箱。圖示大小、顯示類型與路線選擇會自動保存。
- PVE 側欄底部有「道具價值排名」、「混沌船票每日購買建議」及「謎之蛋盒購買」視窗。混沌船票以每場成功獲得 300,000 蛋殼幣為假設，買 10 張時現金淨額最高；蛋盒的開出機率未知。
- 「追蹤」可在選圖後估計人物位置。若遊戲使用 2560×1440 等 16:9 解析度，選 1920×1080；3440×1440 請選對應選項。人物追蹤需 Windows 10 1903 以上。
- 「地圖模式」會開啟透明覆蓋地圖。按 F1 可隱藏／恢復，× 可關閉；遊戲建議使用視窗或無邊框模式。
- PVE 側欄「說明」可查看操作方式。語言選單提供 13 種語言。

設定與更新
設定儲存在 %LOCALAPPDATA%\local.aniimo.dungeonmap\WebView2；同一 Windows 帳號更新版本後沿用。程式會提示 GitHub 新版，下載後請先關閉舊版，再以新版 EXE 替換。畫面只在本機記憶體處理，不上傳或自動保存截圖。
追蹤開啟時會將數值診斷寫入 %LOCALAPPDATA%\local.aniimo.dungeonmap\logs\tracking.log，保留目前與上一份紀錄；不包含截圖。回報正常移動中遺失位置時，可提供發生時間與這兩份紀錄。二樓、背包與開箱造成的小地圖切換或遮蔽仍可能暫停定位。
地圖資料來源版本：3846247；道具圖示來源版本：3634150。
SHA256SUMS.txt 可用於核對發行檔案。

Windows 安全性提示
若顯示「Windows 已保護您的電腦／不明的發行者」，可能是 SmartScreen 對未簽章或尚未建立信譽的下載檔案提出警告，不等於已偵測病毒。僅從本專案 GitHub Releases 下載，並以 PowerShell 的 Get-FileHash .\AniimoDungeonMap.exe -Algorithm SHA256 比對同一版 SHA256SUMS.txt。
若 Windows 安全性列出 Trojan、PUA 等威脅名稱，或檔案遭隔離，請先停止使用並回報完整威脅名稱、版本、檔案 SHA-256 與 Defender 定義版本，以便查核及向 Microsoft 提交分析。請勿關閉防毒或加入排除清單。本機掃描通過並不保證其他電腦不會警告。
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
              embeddedPvpMaps=json.loads((ROOT/'app/asset-manifest.json').read_text(encoding='utf8'))['pvpMaps'],
              difficultyIds=[5,6], monsterTypeIds=[11001200090,11080000101])
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
