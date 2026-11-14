# 伊莫地城地圖開發文件

玩家操作方式見 [使用指南](../README.md)。本文件說明本地建置、封裝與驗證流程。

應用使用 Rust + Tauri 2，目標平台為 Windows x64。建置資料來源為 `exports/grab-eggs-data`、`exports/grab-eggs-dungeons` 與 `exports/pvp-map`。惡夢／混沌地圖池的 12 張地宮底圖、直接引用點位、房間模組補充點與人物追蹤所需檔案，以及 PVP 的六張區域地圖與候選標記，會內嵌於 EXE。

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
3. `sign_windows.ps1`：有指定憑證時，以 SHA-256 簽署並加入 RFC 3161 時間戳，驗證成功才繼續。未指定憑證的本地建置會明確提示未簽章。
4. `package_portable.py`：輸出 `dist/AniimoDungeonMap-<版本>-windows-x64-portable/`，內含 EXE、使用說明、第三方授權與本地校驗檔。簽署在計算雜湊及 ZIP 封裝之前完成。

預設只輸出可直接執行的本地應用。使用者明確需要 ZIP 時，才使用 `scripts/build_portable.ps1 -Zip`，或執行 `scripts/package_portable.py --zip`。封裝採用明確檔案清單，不收錄測試 profile 或 `Data`。`dist/portable-build.json` 記錄可執行檔大小及雜湊；未輸出 ZIP 時 `archive` 為 null。

若預設發行資料夾的 EXE 正在執行，可在編譯完成後執行 `scripts/package_portable.py --output-dir dist/github-release-v<版本>`，將同一份建置封裝到專案內的獨立資料夾。

應用圖示來源為 `src-tauri/icons/icon.png`；`scripts/app_icons.py` 負責 ICO 與 favicon 封裝，來源紀錄見 `src-tauri/icons/source.json`。

## GitHub Release

從 v0.2.45 起只發布免安裝版。程式以 GitHub 最新 Release 資訊提示新版，按下載後由使用者關閉舊程式並替換 EXE；不會下載或執行安裝程式。v0.2.42～v0.2.44 使用舊的 `latest.json` 檢查方式，升級至 v0.2.45 時需手動下載一次。設定仍保存在 `%LOCALAPPDATA%\local.aniimo.dungeonmap\WebView2`。

準備發行時執行：

```powershell
$env:ANIIMO_SIGNING_THUMBPRINT = '填入 Windows 憑證存放區中正式程式碼簽章憑證的指紋'
.\scripts\build_release.ps1
```

腳本建置可攜版 EXE／ZIP，驗證簽章、使用 Microsoft Defender 掃描，再輸出 `dist/github-release-v<版本>/` 的免安裝版附件。正式發版預設要求有效且有時間戳的簽章；目前沒有憑證、明確接受未簽章發行時，使用 `scripts/build_release.ps1 -AllowUnsignedRelease`，仍會掃描。這個選項不會消除 SmartScreen 警告。發布時上傳發行資料夾內全部檔案，再確認 `releases/latest/download/AniimoDungeonMap.exe` 可以下載。新版本號須同時更新 `tauri.conf.json` 與 `Cargo.toml`。

簽章憑證須具有私鑰與 Code Signing 用途，存在 `Cert:\CurrentUser\My` 或 `Cert:\LocalMachine\My`；不將 PFX 密碼放進命令列，也不建立自簽憑證。`sign_windows.ps1 -TimestampServer <URL>` 可指定憑證供應商的 RFC 3161 服務。`Valid` 是本機信任鏈驗證結果，公開發行須使用公開受信任 CA 的憑證；私人 CA 即使在開發電腦受信任，也不能建立一般使用者的發行者信任。有效簽章仍可能需要累積下載信譽，不能保證新版本完全不顯示 SmartScreen。[Microsoft 說明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

Defender 檢查要求 Normal 模式與 48 小時內的安全性情報，結果保存於 `dist/windows-security-v<版本>.json`；請先透過 Windows 安全性更新情報。掃描以 `MpCmdRun -Scan -ScanType 3 -DisableRemediation` 執行：這次自訂掃描會忽略檔案排除項目、檢查 ZIP，並保留原檔供分析，不變更即時防護設定。偵測、掃描失敗或要求的簽章無效時停止發版。`package_release.py` 另核對可攜資料夾校驗檔與 ZIP 每個檔案的內容，避免 ZIP 混入舊 EXE 或簽署後未重算雜湊；直接呼叫這個 Python 腳本只做一致性檢查，不取代完整發版安全檢查。

既有檔案可以單獨查核：

```powershell
.\scripts\verify_windows_security.ps1 -Path '.\dist\github-release-v0.2.50\AniimoDungeonMap.exe' -ReportPath '.\dist\windows-security-check.json'
.\.venv\Scripts\python.exe -X utf8 scripts\tests\release-integrity.test.py
```

無 `-RequireSignature` 時可記錄既有未簽章版本的掃描結果；有簽章但驗證失敗時仍會失敗。報告的 `passed` 只表示本次檢查通過，不代表 SmartScreen 或其他電腦已信任程式。重現下載警告需在乾淨 Windows 測試環境，以瀏覽器下載正式 Release 並保留來源標記後啟動；PowerShell 下載／本機編譯／`--hidden` 測試不能取代這項驗證。

收到回報時先區分 SmartScreen 信譽、Smart App Control 與 Defender 惡意程式偵測。取得完整警告或威脅名稱、SHA-256、下載來源及安全性情報版本；若屬病毒或 PUA 偵測，核對檔案與程式行為後再向 [Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission) 以 Software developer 身分提交原始被擋 EXE，附原始碼網址與視窗擷取／快捷鍵用途說明。不要先改名、重新壓縮或關閉防護來宣稱誤報已解決；未知下載信譽也不能宣稱可透過送審保證解除。

v0.2.52 新增 PVE 單局撤離提醒：獨立擷取左側條件區域，約每 2 秒判斷一次，連續確認繁中「搭乘蛋船安全撤離」後播放內嵌 `伊莫_SuperLucky.wav` 並停止。按同一按鈕取消或開始下一局；不改變地圖辨識與追蹤的擷取。原生實作、範本與驗證方式見 [撤離提醒](../docs/撤離提醒.md)。

v0.2.51 以遊戲資源合成 12 張地宮的初始迷霧畫面並重建迷霧參考（`docs/迷霧合成.md`），辨識改為「門向量 → 起始房間小窗格地形確認」，按 M 後擷取改為約 15 fps。正式 EXE 中 Worker 就緒由約 1.4 秒降為約 0.28 秒，剛進場畫面每張約 24～34 ms，原本無法鎖定的 20031／20033／20038／20061／20062 也能鎖定（`docs/辨識加速.md`）。重建參考：`scripts\build_fog_views.py --fixtures` → `prepare_portable.py` → `node scripts\build_fog_references.cjs` → `package_fog_references.py`。

v0.2.50 恢復 12 張 PVE 地宮辨識、截圖匯入、擷取設定與覆蓋視窗開關。`tracking.js` 統一管理原生擷取，`recognition.js` 只管理地圖辨識；鎖圖後釋放辨識 Worker，啟用的追蹤繼續運作並恢復小地圖裁切。新增 20031、20033、20038、20061、20062 與原 7 張同列第一輪搜尋；保留原 7 張初始迷霧參考，新 5 張目前以地形及門位比對。

辨識回歸：`node --test scripts/tests/*.test.cjs` 的 73 項測試通過。`recognition-lock-native.cjs <EXE> <報告路徑>` 驗證 71 個原圖／迷霧變化案例、16 個門位案例、12 張合成稀疏畫面的誤鎖檢查、12 張完整底圖候選、12 次介面匯入，以及新 5 張各 2 種縮放／遮蔽畫面。舊 7 張匯入使用真實初始迷霧截圖，新 5 張使用底圖；新 5 張尚無真實進場截圖。單獨匯入無門的 20040 底圖會保留正確候選而不鎖定，因為與 20034 共用大量地形；其真實迷霧截圖可經側門複核鎖定。`manual-map-native.cjs` 另驗證 13 語言、手動重選、覆蓋辨識按鈕 IPC、設定保存與切換 PVP 後停止擷取。

v0.2.41 加入混沌船票每日與謎之蛋盒購買建議，精簡側欄並移除地圖辨識。寶箱以原始圖示及金色／淺藍色外框區分，較高的候選寶箱標示 2F。手動選圖及人物追蹤保留。

v0.2.34 新增出口方向手動選圖與覆蓋地圖「重選」。同方向候選用地形縮圖及門位區分；小型覆蓋視窗使用可返回的兩步選擇。

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

### 手機浮窗互動原型

可安裝的 Android 原生版已放在 [`mobile/android`](../mobile/android)，包含跨 App 浮窗、權限、服務、手動選圖與地圖手勢。建置及使用方式見 [手機版說明](../mobile/README.md)。以下檔案保留作為瀏覽器互動原型。

`mobile-preview.html`、`mobile-preview.css` 與 `mobile-preview.js` 是獨立的瀏覽器互動原型，使用現有 12 張地宮及候選點位，不載入人物追蹤、畫面擷取或 OpenCV。它尚未實作 Android 跨 App 浮窗，也不是可安裝的 APK。

在已有 `app/frontend` 建置資料的環境執行 `python scripts/build_mobile_preview.py`，產生 `dist/mobile-preview/手機浮窗互動預覽.html`。雙擊此單檔即可離線操作；缺少前端資料時，先依正常建置流程執行 `scripts/prepare_portable.py`。互動設定使用獨立的 `aniimo-mobile-preview-v1`，不讀寫桌面版偏好。

原型支援拖曳按鈕、依左右位置向內展開、單點地圖收合、地圖平移與雙指縮放、可選靠邊吸附、底色透明度，以及橫直向預覽。拖曳、長按及雙指手勢不觸發單點收合；鍵盤 Enter 可展開、Esc 可收合，並尊重減少動態效果設定。

Android 版使用原生浮窗承載地圖，依按鈕／地圖尺寸調整實際視窗範圍，讓範圍外觸控交給遊戲。已實作浮窗權限、服務生命週期、旋轉與安全邊界，使用者已回報手機測試正常；不同手機與遊戲版本仍須個別確認。手機需求僅為看圖，不申請畫面擷取權限；系統 PiP 的點擊行為不適合直接套用此自訂互動。

### 手動選圖驗證

`app/manual-map-core.js` 依入口至出口的像素向量分組八方向，資料取自內嵌 12 張地圖的 `portalGeometry`。主方向不變；手動初篩在每個 45° 區間兩端各容許 8°，主方向候選排在相鄰候選前。這是操作容錯，未當作實測的人類角度誤差或辨識成功率。沒有以人物位置或地圖中心推算方向，也不需要擷取遊戲畫面。

`manual-map.js` 在主視窗與覆蓋視窗共用兩步介面，方向按鈕只縮小候選範圍，單一候選也須點選確認。預設「門位」圖使用遊戲原始門圖示，同一組候選的入口對齊、像素比例一致，裁掉共同的多餘留白；可切換完整「地形」縮圖。只有同主方向的最遠／最近門距離比達 1.2，才顯示「較近／較遠」。標籤比較候選圖彼此，不能拿不同遊戲縮放下的畫面像素直接比對。相鄰候選以文字及虛線框標示，返回按鈕恢復上一個方向焦點。「顯示全部地圖」在兩步皆可使用。覆蓋視窗經事件送交主視窗套用並等待結果。

`node --test scripts/tests/manual-map.test.cjs` 直接讀取現行地圖池及匯出門位，核對 12 張主方向、8 組完整候選、容錯邊界、角度環繞、縮放平移不變性及遠近標籤，不再依賴歷史七張圖 fixture。`node scripts/tests/manual-map-native.cjs` 以隔離 profile、隱藏視窗驗證首次啟動、12 張選圖、13 語言、門位／地形切換、單一候選確認、相鄰候選選取、原生覆蓋同步、重新啟動保存，以及 590／400／295 像素視窗中的真實滑鼠點擊；截圖與結果輸出到 `dist/manual-map-preview/`。有畫面擷取控制項的版本另執行 `tracking-controls-browser.js` 的假擷取邊界測試，不連接遊戲。

### 多語介面

道具價值排名使用 `app/loot-ranking.json` 的離線快照。`scripts/extract_loot_ranking.py` 從本機 `LuaScripts.xdf` 解碼寶箱獎勵群組 `520005` 的 24 種金色寶物，另加入高級脈衝能量石（5030203）、高級諧振能量石（5030213）、金魄（5001002）與鎏金鑰匙（5001103）。遍歷 `rob_egg_item_in` 中可帶出的紫色道具，收錄 `item_data.quality = 4`、`sellPrice / weight > 7000` 且 `item_data.type` 非 10、14、15、16 者，共 3 種，包含鍍銀鑰匙（5001102）；另明確收錄紫魄（5001001），其重量 1、售價 6,750，低於一般紫色道具門檻。也明確收錄初級脈衝能量石（5030201）和初級諧振能量石（5030211）；兩者皆為藍色品質，重量 1、售價 7,000。類型 10、14、15、16 分別是背包、攻擊增幅器、防護機體與晶片。核對帶出道具售價與所有道具的 `stackcount = 1` 後，以 25 格／70 kg、每件 1 格計算背包 CP。`scripts/loot_capacity.py` 統一計算 `sellPrice / max(1, weight * 25 / 70)`，以分數精確排序，同值並列，畫面最多顯示兩位小數。原本每單位重量 7,000 的門檻只用於決定收錄哪些紫色道具。名稱從 13 種語言的 `NewTextMap_*` 與 `Compress_*.bin` 解碼；部分新增道具缺少日文、韓文遊戲翻譯，顯示遊戲英文名稱。快照包含文字鍵、道具 ID、堆疊上限、背包容量、CP、同物裝包件數／重量／總售價、紫色門檻、明確收錄項目、排除類型、翻譯備援紀錄及來源檔案 SHA-256。

每列名稱旁顯示 `item_data.icon` 指向的遊戲原始圖示。更新排名後執行 `scripts/extract_loot_icons.py`，會讀取目前安裝的資源版本清單（可用 `--version` 指定），將排名所需原始紋理匯出至 `app/loot-icons/`，並記錄來源 bundle、尺寸與 SHA-256。正常建置僅驗證並複製已匯出的 PNG，不需遊戲檔案或網路。`i18n-browser.js` 會在原生視窗驗證全部圖示可解碼，且切換 13 語言後仍對應正確道具。

背包平均每格可分配 70 ÷ 25＝2.8 kg。CP 以格數與重量兩者較大的容量占比折算成等效格數：2.8 kg 以下每件仍消耗一格，CP 等於售價；較重者按重量折算。這是靜態拾取參考，沒有假設常見道具或稀有道具的掉率，也不是混合背包的最優解。若格數已滿、重量仍夠，可優先以較高單價換掉低價道具；若重量接近上限，則需比較每公斤價值與實際能否放入。

同物裝包試算為 `min(25, floor(70 / weight))` 件，乘以單價及重量得到整件總售價／總重量。此欄假設有足夠同種道具，不等於每場預期收益，也不作為 CP 排序鍵。例如鉑金礦最多 11 件／66 kg，剩餘 4 kg 可由其他道具補足，所以同物總價排序可能與 CP 不同。`python scripts/tests/loot-capacity.test.py` 驗證格數限制、重量限制、2.8 kg 邊界、整件試算、精確同值排名及重算後的代表道具順序。

排名共 34 種道具：24 種金色寶箱寶物、4 種額外金色道具、3 種達門檻且非排除類型的紫色道具、紫魄，以及 2 種初級能量石。畫面使用單欄表格。未推論伺服器掉落機率或空白禮包的內容。`build_loot_ranking.py` 在網頁與可攜版建置時驗證語言完整性、品質、紫色門檻、明確收錄項目、排除類型及排名，再內嵌資料，正常建置不需要讀取遊戲。`i18n-browser.js` 驗證 13 語言名稱、數值、同值排名、彈窗即時翻譯與焦點返回，並確認三個側欄區塊已移除。

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
