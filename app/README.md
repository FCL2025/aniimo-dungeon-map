# 伊莫地城地圖桌面版

Rust + Tauri 2 的 Windows x64 可攜應用。資料來源為 `exports/grab-eggs-data`，僅將 31 張地城底圖與目前使用的欄位內嵌於 EXE。

功能包含地圖／難度切換、獎勵與首領級幽黯星法師篩選、縮放平移、視窗置頂、收合側欄的地圖模式，以及篩選設定保存。

0.2.2 採用工具列開關及側欄內嵌設定，移除辨識彈窗。Evidence 將候選預覽和鎖定分離，未達 200 點先跟隨當前第一名，達 200（含）即永久鎖定至新一場。以提供的 M 地圖標題灰階特徵辨識開圖畫面，初始 10 點即可預覽；此標題特徵待更多 UI 縮放與語言驗證。取樣由 Win32 前景 M 按鍵上升沿觸發 2.4 秒加速，沒有鍵盤 Hook 或按鍵注入。原生快照上限 5 張／秒、前端最多排隊 3 張、重複畫面略過；鎖定後只做單圖定位。紀錄見 `dist/recognition-verification-0.2.2.json`。

0.2.1 以候選顯示的幾何吻合點數排序；M 地圖最高候選嚴格超過 200 點時自動切換，不要求領先第二名的差距，並會取代原先手動確認。低於門檻時保留原有地形與累積判定。地宮切換會清除舊定位連續性及軌跡。已匯入實際同場迷霧截圖驗證 20040；紀錄見 `dist/recognition-verification-0.2.1.json`。

0.2.0 加入 Windows Graphics Capture 的遊戲視窗擷取、M 地圖截圖匯入、部分地形辨識與候選累積、手動確認，以及地宮確認後的小地圖中心定位和軌跡。辨識仍是測試版，實際迷霧／樓層／移動需由遊戲畫面校準，尚未實作滑鼠穿透。`recognition-worker.js` 在 Web Worker 內使用本地 OpenCV.js，`recognition-core.js` 負責幾何驗證與判定；Rust 僅擷取使用者選取的 Aniimo.exe 視窗，不讀取遊戲記憶體或送出按鍵。見 [即時辨識測試版](../docs/即時辨識測試版.md)。

0.1.1 將選單與標題改成地宮編號，並內嵌 10 張遊戲原始圖示，覆蓋全部 11 個分類與每個候選點。一般／高級寶箱按物件設定切換；陶罐、其他搜刮點共用遊戲設定的寶箱圖示，首領使用星法師肖像。來源見 [圖示與地圖名稱](../docs/圖示與地圖名稱.md)。

## 可攜資料

`src-tauri/src/main.rs` 將 WebView2 使用者資料目錄設為 EXE 旁的 `Data/WebView2`。前端篩選偏好保存在此 WebView2 profile 的 localStorage，應用不依賴原始遊戲路徑、Python 或開發環境。

Windows 執行時使用電腦既有的 WebView2 Runtime；未隨包附加固定版本 Runtime。此選擇與安裝版／可攜版是兩件事：可攜應用也能使用系統 Runtime。參考 [Tauri Windows WebView2 說明](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)。

`.cargo/config.toml` 固定 Windows x64 目標並靜態連結 C runtime，發行 EXE 不另依賴 Visual C++ Redistributable 的 `VCRUNTIME140.dll`／`VCRUNTIME140_1.dll`。

## 編譯及封裝

開發環境需要 Rust MSVC toolchain、Visual Studio C++ 工具、Windows SDK，以及專案的 Python 虛擬環境。`Cargo.lock` 固定相依版本。

在專案根目錄執行：

```powershell
.\scripts\build_portable.ps1
```

腳本依序執行：

1. `prepare_portable.py`：產生 `app/frontend`，檢查地城／首領範圍，記錄 `asset-manifest.json`。
2. `cargo build --release --locked`：建置包含內嵌前端的正式 EXE。
3. `package_portable.py`：輸出 `dist/AniimoDungeonMap-<版本>-windows-x64-portable/AniimoDungeonMap.exe` 與說明、授權、校驗檔，預設不製作 ZIP。

使用者明確需要 ZIP 時，才執行 `scripts/build_portable.ps1 -Zip`，或對已編譯的版本執行 `scripts/package_portable.py --zip`。ZIP 使用明確檔案清單，只包含 EXE、使用說明、第三方授權與 SHA-256 校驗檔，不收錄測試 profile 或 `Data`。`dist/portable-build.json` 記錄本次可執行檔的大小及雜湊；未輸出 ZIP 時 `archive` 為 null，不更新既有 ZIP。

## 原生驗證

可在獨立測試資料夾複製 EXE，再以 `--hidden` 啟動隱藏視窗。只有測試啟動時，才透過該程序的 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 開啟本機 CDP 偵錯連線，供 agent-browser 檢查實際 WebView2、IPC、置頂、視窗大小與設定保存。正式執行不設定偵錯埠。

只靠瀏覽器開啟 `frontend/index.html` 無法驗證原生置頂功能，因此發行前須驗證實際 EXE。

0.1.0 已在本機以正式 EXE 驗證：31 張內嵌 PNG 全數載入、原生置頂開關、600 × 560 地圖模式與視窗還原、難度與首領篩選、內建說明，以及重啟後恢復選圖、篩選與視窗模式。另從最終 ZIP 解壓到獨立資料夾啟動，確認建立旁置 `Data`、正常關閉、預設不開偵錯埠。發行 EXE 的 DLL 匯入不含 Visual C++ Redistributable；測試 EXE 與發行 EXE 的 SHA-256 相同。

此驗證使用本機既有 WebView2，未在未安裝 Runtime 的新電腦上驗證，也未驗證遊戲獨佔全螢幕覆蓋。紀錄見 `dist/native-verification.json`。

0.1.1 另由最終 ZIP 解壓啟動 EXE，驗證 31 張底圖與 10 張圖示載入、62 組地圖／難度切換、圖例與選取明細、實際滑鼠點選出口、品質／補充／首領篩選，以及原生置頂與地圖模式。12,801 筆圖示對應已逐筆核對遊戲設定，測試 EXE 與發行 EXE 雜湊一致，紀錄見 `dist/native-verification-0.1.1.json`。
