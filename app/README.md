# 伊莫地城地圖開發文件

玩家操作方式見 [使用指南](../README.md)。本文件說明本地建置、封裝與驗證流程。

應用使用 Rust + Tauri 2，目標平台為 Windows x64。建置資料來源為 `exports/grab-eggs-data` 與 `exports/grab-eggs-dungeons`，惡夢／混沌地圖池的 7 張地宮底圖、直接引用點位、房間模組補充點及辨識引擎會內嵌於 EXE。

## 建置環境

- Rust MSVC toolchain、Visual Studio C++ 工具與 Windows SDK。
- Python 虛擬環境及根目錄 `requirements.txt` 中的套件。
- 執行及原生驗證需要 Microsoft Edge WebView2 Runtime。

在專案根目錄準備 Python 環境：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`Cargo.lock` 固定 Rust 相依版本。`.cargo/config.toml` 指定 Windows x64 目標並靜態連結 C runtime，發行 EXE 不另依賴 Visual C++ Redistributable。

## 編譯及封裝

在專案根目錄執行：

```powershell
.\scripts\build_portable.ps1
```

腳本依序執行：

1. `prepare_portable.py`：產生 `app/frontend`，檢查地城與首領範圍，記錄 `asset-manifest.json`。
2. `cargo build --release --locked`：建置包含內嵌前端的 EXE。
3. `package_portable.py`：輸出 `dist/AniimoDungeonMap-<版本>-windows-x64-portable/`，內含 EXE、使用說明、第三方授權與本地校驗檔。

預設只輸出可直接執行的本地應用。使用者明確需要 ZIP 時，才使用 `scripts/build_portable.ps1 -Zip`，或執行 `scripts/package_portable.py --zip`。封裝採用明確檔案清單，不收錄測試 profile 或 `Data`。`dist/portable-build.json` 記錄可執行檔大小及雜湊；未輸出 ZIP 時 `archive` 為 null。

若預設發行資料夾的 EXE 正在執行，可在編譯完成後執行 `scripts/package_portable.py --output-dir dist/github-release-v<版本>`，將同一份建置封裝到專案內的獨立資料夾。

應用圖示來源為 `src-tauri/icons/icon.png`；`scripts/app_icons.py` 負責 ICO 與 favicon 封裝，來源紀錄見 `src-tauri/icons/source.json`。

## GitHub Release

v0.2.34 新增出口方向手動選圖與覆蓋地圖「重選」。同方向候選用地形縮圖及門位區分；小型覆蓋視窗使用可返回的兩步選擇。辨識預設關閉，手動操作會取消未完成辨識，避免延遲結果改回舊圖。

v0.2.33 提供「路線 1／路線 2」分工：琉璃候選與可選鑰匙房不重複，兩邊的候選與門數差距最多 1，並保存路線選擇及同步覆蓋地圖。規劃與驗證方式見 [雙人分工路線](../docs/最佳路徑.md)。

GitHub Release 發布以下附件：

- `AniimoDungeonMap.exe`
- `AniimoDungeonMap-<版本>-windows-x64-portable.zip`：包含 EXE、使用說明與第三方授權。
- `README.zh-TW.txt`：使用說明採英文檔名，避免 GitHub 自動重新命名。
- `SHA256SUMS.txt`：供下載者核對檔案。
- `THIRD_PARTY_NOTICES.txt`：第三方元件授權與版權聲明。

版本更新內容寫在 Release，README 維持使用與建置指南。根目錄 README 的下載連結指向 GitHub 最新版，無須每次發版手動更改版本號。

本地發行資料夾與壓縮檔預設保留最新版及前兩版。新版驗證完成後執行 `scripts/prune_releases.ps1 -Apply`；不帶 `-Apply` 可先查看清理清單。若只保留最新版並清除舊版發行／測試副本，使用 `scripts/prune_releases.ps1 -KeepCount 1 -IncludeTestCopies -Apply`。共用使用者設定不在清理範圍內。

## 設定與資料保存

`src-tauri/src/main.rs` 將 WebView2 資料放在 `%LOCALAPPDATA%\local.aniimo.dungeonmap\WebView2`。識別碼與 localStorage key 不隨版本變動，同一帳號更新、移動 EXE 或刪除發行資料夾後仍保留設定。

`src-tauri/src/profile.rs` 僅在共用 profile 尚不存在時匯入舊設定：優先使用 EXE 旁的 `Data/WebView2`，其次尋找同層 `AniimoDungeonMap-*-windows-x64-portable` 中最近使用的設定。只複製 localStorage，保留原檔；舊版尚在執行時會提示先關閉，既有共用 profile 不會被舊資料覆寫。

搬到另一台電腦時，先關閉所有版本，再將 `%LOCALAPPDATA%\local.aniimo.dungeonmap` 複製到新電腦的相同位置。新電腦仍需安裝 WebView2 Runtime。

## 原生驗證

將發行 EXE 複製到獨立測試資料夾，以 `--hidden` 啟動。設定 `ANIIMO_TEST_DATA_DIR` 指向隔離資料根目錄，避免寫入使用者設定；此覆寫僅在 `--hidden` 模式生效。

測試程序可透過 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 開啟本機 CDP 偵錯連線，使用 agent-browser 檢查實際 WebView2、IPC、側欄切換、置頂、覆蓋地圖與設定保存。正式執行不設定偵錯埠。發行前須以實際 EXE 驗證，單獨開啟 `frontend/index.html` 無法確認原生視窗功能。

## 技術資料

### 手動選圖驗證

`app/manual-map-core.js` 依入口至出口的像素向量分組八方向，資料取自內嵌七張地圖的 `portalGeometry`。沒有以人物位置或地圖中心推算方向，也不需要擷取遊戲畫面。`manual-map.js` 在主視窗與覆蓋視窗共用介面；覆蓋視窗經事件送交主視窗套用並等待結果。

`node --test scripts/tests/manual-map.test.cjs` 核對七張地圖的方向及左側兩張候選。`node scripts/tests/manual-map-native.cjs` 以隔離 profile、隱藏視窗驗證首次啟動、七張選圖、13 語言、原生覆蓋同步、重新啟動保存，以及 590／400／295 像素視窗中的真實滑鼠點擊；截圖與結果輸出到 `dist/manual-map-preview/`。其中辨識延遲回傳、原生擷取啟動中的取消，以及同圖重選的追蹤重置，透過 `tracking-controls-browser.js` 的假擷取邊界測試，不連接遊戲。

### 多語介面

金色道具排名使用 `app/loot-ranking.json` 的離線快照。`scripts/extract_loot_ranking.py` 從本機 `LuaScripts.xdf` 解碼寶箱獎勵群組 `520005` 的 24 種金色寶物，以 `item_data.quality = 5` 篩選，讀取 `weight`／`sellPrice`，並核對 `rob_egg_item_in.outid` 對應的帶出道具售價。以分數精確排序售價／重量，同值並列，畫面最多顯示兩位小數。名稱直接解碼 13 種語言的 `NewTextMap_*` 與 `Compress_*.bin`；快照包含文字鍵、道具 ID 及來源檔案 SHA-256。

排名範圍是寶箱獎勵清單可核實的金色寶物，未將背包、裝備、鑰匙或蛋混入寶物排名，也未推論伺服器掉落機率或空白禮包的內容。`build_loot_ranking.py` 在網頁與可攜版建置時驗證語言完整性、品質及排名，再內嵌資料，正常建置不需要讀取遊戲。`i18n-browser.js` 驗證 13 語言名稱、數值、同值排名、彈窗即時翻譯與焦點返回，並確認三個側欄區塊已移除。

`app/locales/<語言代碼>.json` 保存 13 種語言，`bindings.json` 對應靜態介面文字。動態訊息使用 `I18n.msg(key, params)` 與 `I18n.bind(node, message)`；參數可以巢狀使用訊息，讓語序依語言調整。翻譯只寫入文字或屬性，不插入 HTML。

`scripts/build_i18n.py` 在兩種前端建置時驗證所有鍵與參數一致，將語言檔打包為本地 `locales.js`。不需網路或額外翻譯服務。找不到翻譯時依序使用英文、繁體中文；未知語言設定使用繁體中文。偏好鍵為 `aniimo-language-v1`，不取代既有地圖設定。

切換語言更新既有文字節點，不重建控制項或重啟辨識工作執行緒。主視窗經由 `map-view-state` 同步語言至覆蓋地圖；狀態判斷使用 `statusKey`，不比對翻譯後的文字。

將 `scripts/tests/i18n-browser.js` 交由 agent-browser `eval --stdin` 可驗證選單、翻譯與地圖狀態保留。`node scripts/tests/i18n-native.cjs <EXE 路徑>` 會用隔離 profile、隱藏視窗驗證桌面版的 13 語言、覆蓋同步、標題與重新啟動後的設定保存，並將結果輸出至 `dist/i18n-preview/`。辨識與追蹤不中斷的測試使用假擷取邊界，不連接遊戲。

- [地圖資料解析](../docs/解析報告.md)
- [人物追蹤](../docs/人物追蹤.md)
- [正門／側門辨識加速與驗證](../docs/辨識加速.md)
- [覆蓋地圖](../docs/覆蓋地圖.md)
- [F1 覆蓋地圖快捷鍵](../docs/覆蓋地圖快捷鍵.md)
- [設定保存驗證](../docs/設定保存驗證.md)
