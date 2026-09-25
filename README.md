# 伊莫搶蛋地圖

桌面本地版：**[開啟 Windows x64 EXE · 0.2.2 測試版](dist/AniimoDungeonMap-0.2.2-windows-x64-portable/AniimoDungeonMap.exe)**。不需要安裝本工具，地圖、點位、遊戲圖示與辨識引擎已內嵌。依使用者偏好，之後預設只輸出可直接開啟的本地應用，明確需要時才建立 ZIP。

0.2.2 改為工具列「辨識」開關，開啟即連接遊戲。初始迷霧也先跟隨第一名預覽；達 200 個吻合點（含）就鎖定本場，不再換圖，直到按「新一場」。遊戲在前景時按 M，會短暫加強取樣 2.4 秒；重複畫面略過、排隊最多 3 張、鎖定後不再搜尋 31 張地宮。可在側欄展開設定與候選。

0.2.0 新增「辨識地圖」：連接伊莫視窗或匯入 M 地圖截圖，部分地形不足以確認時保留候選、等待後續 M 地圖。確認地宮後嘗試以小地圖中心估計位置與軌跡。這是待實機校準的測試版，不保證迷霧或樓層變化下能定位。使用方法、驗證結果與需要的遊戲畫面見 [即時辨識測試版](docs/即時辨識測試版.md)。

0.1.1 移除參考圖檔名與括號描述，改用地宮編號；標記換成遊戲原始圖片。陶罐與其他搜刮點依遊戲設定共用寶箱圖示，首領使用星法師肖像。詳見 [圖示與地圖名稱](docs/圖示與地圖名稱.md)。

提供手動選圖、惡夢／混沌、獎勵與首領級幽黯星法師篩選、置頂、地圖模式、設定保存與測試版畫面辨識。需要 Windows 10/11 x64 與 Microsoft Edge WebView2 Runtime；即時擷取需要 Windows 10 1903 以上。其他電腦缺少 Runtime 時可依包內使用說明安裝。

首次啟動會在 EXE 旁建立 `Data` 資料夾。建置與架構說明見 [桌面版 README](app/README.md)；執行 `scripts/build_portable.ps1` 預設只輸出本地應用，明確需要 ZIP 時才加 `-Zip`。

## 離線網頁與解析資料

直接開啟 **[點位檢視器](exports/grab-eggs-data/index.html)**，切換地圖、惡夢／混沌、獎勵類型與寶箱品質。不需要啟動伺服器。

原始圖片與並排對照保存在 [底圖圖庫](exports/grab-eggs-dungeons/index.html)。詳細資料關係、難度設定及限制見 [解析報告](docs/解析報告.md)。

工具範圍限定地城內：使用 `grab-eggs-dungeons` 的單張底圖，不載入額外分層貼圖。`grab-eggs` 是前期調查留下的外部地圖，不納入工具。怪物只顯示「首領級幽黯星法師」，其他開關仍為寶箱、蛋巢、陶罐與鑰匙等。

## 本次結果

- 遊戲來源：`F:\Pawprint\Aniimo\game`，資源版本 `3595896`。
- 使用者提供的 31 張範例，對應 `20031`–`20060` 加上 `29999`，共 31 個地宮底圖。
- 每個地宮底圖為 8 × 8 個 256 × 256 切片，拼成 2048 × 2048 PNG；另保存相應分層貼圖。
- 30 張範例通過自動輪廓比對；`1(下).jpg` 的下緣有裁切，目視核對對應 `20034`，另記錄此判斷，未把低分改成高分。
- 最初查到的 `3004` 是外部島嶼地圖，384 片拼成 6144 × 4096，另有 30 個分層切片；414 個原定條目均已提取。
- 沒有修改遊戲或使用者的範例原檔。
- 已解析 `pmdata.bin`，確認惡夢／混沌難度 ID 為 5／6；PvE 入口場景為 3005，3004 為 PvP。
- 已匯出 12,543 筆地圖直接引用的候選紀錄，以及 258 筆依共用房間模組補出的候選；補充點在檢視器以虛線外圈顯示並可關閉。
- 首領級幽黯星法師 ID 為 `11001200090`，共 108 筆候選紀錄（惡夢／混沌各 54 筆），包含不同難度的相近位置與模組補充候選，不代表每場必定生成。
- 座標涵蓋 31 張圖，入口／出口合計 62 個引用全部能回連；4 個來源群組 ID 缺失，涉及 11 張圖、27 次引用，另有完整紀錄。

## 檔案位置

| 位置 | 內容 |
| --- | --- |
| `exports/grab-eggs-data/index.html` | 地圖與候選點篩選、縮放、來源明細 |
| `exports/grab-eggs-data/maps/` | 各地圖座標與房間 JSON |
| `exports/grab-eggs-data/candidates.csv` | 全部候選紀錄，含難度與來源判斷 |
| `exports/grab-eggs-data/difficulty.json` | 惡夢／混沌設定與生成參數 |
| `exports/grab-eggs-data/monster-types.json` | 僅首領級幽黯星法師的設定 |
| `exports/grab-eggs-data/display-policy.json` | 地城限定、單張底圖及高度投影策略 |
| `exports/grab-eggs-data/validation.json` | 入口／出口檢查、來源缺漏與模板匹配 |
| `exports/grab-eggs-dungeons/index.html` | 31 張地宮圖庫、原尺寸 PNG 與範例對照入口 |
| `exports/grab-eggs-dungeons/reference-matches.csv` | 範例檔名與地圖 ID 對應，可用 Excel 開啟 |
| `exports/grab-eggs-dungeons/reference-matches.json` | 比對分數、次佳候選、比對版本與目視核對備註 |
| `exports/grab-eggs-dungeons/tiles/` | 原始切片；包含初期調查候選 `20020`–`20030`，這些候選不列入主要圖庫 |
| `exports/grab-eggs-dungeons/preview/` | 地宮底圖、分層、疊圖、裁掉透明邊界的版本、縮圖與切片編號圖 |
| `exports/grab-eggs-dungeons/comparison/` | 31 張並排對照圖 |
| `exports/grab-eggs/` | `3004` 外部地圖及 `3004_1`、`3004_2` 分層 |
| `exports/dungeon-samples/` | 初期辨認用樣本，主要成果以地宮圖庫為準 |

各輸出目錄的 `manifest.json` 包含每張圖片的來源封包、尺寸、SHA-256、提取狀態。
`preview/assembly.json` 包含拼接座標方向與邊界差異數值；`composites.json` 記錄疊圖來源。
拼接保留來源切片像素，未重新繪製。圖庫縮圖與比較圖為展示用衍生圖片。

## 判斷限制

- 圖庫是純地圖底圖，沒有把參考圖中的寶箱、蛋與其他圖示畫入原圖。
- 難度與候選座標已解析；獎勵群組會抽選，候選紀錄包含互斥與重疊項目，不是單場生成數。每場完整生成規則、伺服器抽圖池與即時角色定位尚未驗證。
- 部分房間引用缺少來源資料，模組補充點也是待核對推論；詳見解析報告。切換難度會篩選蛋巢模組，寶箱保留各候選群組。
- 自動分數是縮放後輪廓交集比與長寬比的一致度，不是辨識成功機率；尚非即時小地圖定位測試。
- 底圖與分層直接 alpha 疊合會呈現其他樓層變暗的效果。疊图僅供比對，未宣稱重現遊戲材質效果或所有顯示區域同時可通行。
- 腳本支援的是這個遊戲版本的緊湊 manifest 格式，不是通用 YooAsset 匯出器；版本結構不符會報錯。

## 重跑

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$mapGroups = @('29999', '29999_1') + @(20031..20060 | ForEach-Object { [string]$_; [string]$_ + '_1' })
.\.venv\Scripts\python.exe scripts\extract_maps.py --groups $mapGroups --output exports\grab-eggs-dungeons
.\.venv\Scripts\python.exe scripts\build_previews.py exports\grab-eggs-dungeons
.\.venv\Scripts\python.exe scripts\compare_references.py
.\.venv\Scripts\python.exe -X utf8 scripts\parse_dungeon_data.py
```

`extract_maps.py` 支援 `--game`、`--version`、`--groups`、`--output`。
`--append` 只允許向相同 manifest 來源的提取紀錄追加群組；不存在的封包或解碼錯誤會記入失敗項目，不下載遊戲資源。

工具依賴：[UnityPy](https://github.com/K0lb3/UnityPy)、[Pillow](https://pillow.readthedocs.io/)。
