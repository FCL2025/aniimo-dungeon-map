# 伊莫地城地圖開發文件

玩家操作方式見 [使用指南](../README.md)。本文件說明本地建置、封裝與驗證流程。

應用使用 Rust + Tauri 2，目標平台為 Windows x64。建置資料來源為 `exports/grab-eggs-data` 與 `exports/grab-eggs-dungeons`，惡夢／混沌地圖池的 7 張地宮底圖、直接引用點位及辨識引擎會內嵌於 EXE。

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

應用圖示來源為 `src-tauri/icons/icon.png`；`scripts/app_icons.py` 負責 ICO 與 favicon 封裝，來源紀錄見 `src-tauri/icons/source.json`。

## GitHub Release

依使用者偏好僅上傳以下附件：

- `AniimoDungeonMap.exe`
- `README.zh-TW.txt`：使用說明採英文檔名，避免 GitHub 自動重新命名。
- `THIRD_PARTY_NOTICES.txt`：第三方元件授權與版權聲明。

不發布 `SHA256SUMS.txt`；校驗檔保留供本地建置核對，公開使用說明須移除校驗檔的下載描述。版本更新內容寫在 Release，README 維持使用與建置指南。

本地發行資料夾與壓縮檔最多保留最新版及前兩版。新版驗證完成後執行 `scripts/prune_releases.ps1 -Apply`；不帶 `-Apply` 可先查看清理清單。共用使用者設定不在清理範圍內。

## 設定與資料保存

`src-tauri/src/main.rs` 將 WebView2 資料放在 `%LOCALAPPDATA%\local.aniimo.dungeonmap\WebView2`。識別碼與 localStorage key 不隨版本變動，同一帳號更新、移動 EXE 或刪除發行資料夾後仍保留設定。

`src-tauri/src/profile.rs` 僅在共用 profile 尚不存在時匯入舊設定：優先使用 EXE 旁的 `Data/WebView2`，其次尋找同層 `AniimoDungeonMap-*-windows-x64-portable` 中最近使用的設定。只複製 localStorage，保留原檔；舊版尚在執行時會提示先關閉，既有共用 profile 不會被舊資料覆寫。

搬到另一台電腦時，先關閉所有版本，再將 `%LOCALAPPDATA%\local.aniimo.dungeonmap` 複製到新電腦的相同位置。新電腦仍需安裝 WebView2 Runtime。

## 原生驗證

將發行 EXE 複製到獨立測試資料夾，以 `--hidden` 啟動。設定 `ANIIMO_TEST_DATA_DIR` 指向隔離資料根目錄，避免寫入使用者設定；此覆寫僅在 `--hidden` 模式生效。

測試程序可透過 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 開啟本機 CDP 偵錯連線，使用 agent-browser 檢查實際 WebView2、IPC、側欄切換、置頂、覆蓋地圖與設定保存。正式執行不設定偵錯埠。發行前須以實際 EXE 驗證，單獨開啟 `frontend/index.html` 無法確認原生視窗功能。

## 技術資料

- [地圖資料解析](../docs/解析報告.md)
- [人物追蹤](../docs/人物追蹤.md)
- [正門／側門辨識加速與驗證](../docs/辨識加速.md)
- [覆蓋地圖](../docs/覆蓋地圖.md)
- [F1 覆蓋地圖快捷鍵](../docs/覆蓋地圖快捷鍵.md)
- [設定保存驗證](../docs/設定保存驗證.md)
