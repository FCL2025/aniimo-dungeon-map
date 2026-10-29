# Android 浮動地圖

獨立 Android App，最低 Android 8.0（API 26）。以原生 Java／Canvas 顯示 12 張地宮與 1,321 個候選點；與桌面 Tauri 版共用已解析的地圖資料，手機介面、設定與服務分開。沒有 WebView、網路權限、畫面擷取、人物辨識或追蹤工作執行緒。

## 安裝與操作

**[下載 Android v0.1.1 測試版 APK](https://github.com/FCL2025/aniimo-dungeon-map/releases/download/android-v0.1.1/AniimoDungeonMap-0.1.1-android-test.apk)** · [GitHub Release／校驗碼](https://github.com/FCL2025/aniimo-dungeon-map/releases/tag/android-v0.1.1)

本地建置輸出：`dist/android/AniimoDungeonMap-0.1.1-android-test.apk`。這是本機 debug 金鑰簽署的測試 APK，未上架商店；安裝步驟見 [INSTALL.txt](INSTALL.txt)。

- 按「開啟浮動地圖」，授予顯示在其他應用程式上層的權限，再切回遊戲。
- 拖曳蛋形按鈕，點一下向畫面內側展開；左側向右、右側向左，收合回原位置。
- 單點地圖收合，拖曳平移、雙指縮放、長按不會誤收合。工具列可重選、顯示全圖與收合。
- 以入口至出口方向與縮圖手動選圖，支援惡夢／混沌、標記篩選、底色透明度、尺寸及可選靠邊吸附。
- 橫直向各自保存位置，旋轉時收合並限制在安全邊界內。鎖定螢幕時隱藏，解鎖後恢復。
- 從主畫面或通知列關閉。服務不在開機時自動啟動，也不在被系統終止後強制重啟。

浮窗以 `TYPE_APPLICATION_OVERLAY` 實作，實際視窗跟隨按鈕或地圖大小，範圍外的觸控交給下方 App。Android 14 以上使用 `specialUse` 前景服務，Manifest 記錄用途。通知權限遭拒仍可開啟浮窗並從主畫面關閉。系統或遊戲明確禁止浮窗的畫面會隱藏它。

## 建置

需要 JDK 17 以上（本機驗證為 JDK 25）、Python 3.10 以上及專案 Python 依賴、Android SDK Platform 36、Build-Tools 36.0.0。Gradle Wrapper 固定 9.5.1 並核對下載雜湊，Android Gradle Plugin 為 9.2.0。首次建置需網路下載建置依賴，App 執行不需要網路。

在根目錄 PowerShell 執行：

```powershell
./scripts/build_mobile.ps1
# 或指定 SDK 與 Python：
./scripts/build_mobile.ps1 -SdkPath C:/Android/Sdk -Python ./.venv/Scripts/python.exe
```

腳本依序驗證／複製離線資料、建置 APK、執行幾何單元測試與 Android Lint、驗證簽章，並輸出 APK、安裝說明、SHA-256 與建置紀錄。設定放在忽略版控的 `local.properties`。為避開 Windows 中文路徑造成的 Gradle 測試工作程序類別載入問題，建置輸出預設在 `%LOCALAPPDATA%/AniimoDungeonMap/android-build`；使用者名稱含非 ASCII 字元時，傳入如 `-BuildRoot C:/AndroidBuild/Aniimo`。

`scripts/prepare_mobile.py` 只複製 12 張底圖、必要圖示及精簡 `maps.json`，檢查圖示雜湊及檔案白名單。來源為 `exports/grab-eggs-data` 和 `exports/grab-eggs-dungeons/preview`；不需重新解析遊戲。生成資源與建置輸出不進版控。桌面版可照原方式獨立建置。

## 驗證

`OverlayGeometryTest` 驗證左右展開、旋轉比例位置及 5,000 組安全邊界。`MobileSmokeInstrumentation` 在真正的 Android 輸入分派器注入觸控，檢查跨 App 展開、左右拖曳、地圖平移、雙指縮放、單點收合、最小尺寸選圖、位置保存、靠邊吸附與旋轉。此測試會重設測試 App 偏好，只允許在可拋棄的 Android 模擬器執行。

先啟動模擬器（建議 API 35，1080 × 2400／420 dpi），再執行：

```powershell
cd mobile/android
$nativeRoot = Join-Path $env:LOCALAPPDATA 'AniimoDungeonMap/android-build'
./gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest "-PaniimoBuildRoot=$nativeRoot"
adb -s emulator-5580 install -r "$nativeRoot/app/outputs/apk/debug/app-debug.apk"
adb -s emulator-5580 install -r "$nativeRoot/app/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
adb -s emulator-5580 shell appops set local.aniimo.dungeonmap.mobile SYSTEM_ALERT_WINDOW allow
adb -s emulator-5580 shell pm grant local.aniimo.dungeonmap.mobile android.permission.POST_NOTIFICATIONS
adb -s emulator-5580 shell am instrument -w local.aniimo.dungeonmap.mobile.test/local.aniimo.dungeonmap.mobile.MobileSmokeInstrumentation
```

請替換為自己的模擬器序號。測試截圖寫在模擬器 `/sdcard/Android/data/local.aniimo.dungeonmap.mobile/files/`；測試 APK 不放入交付資料夾。權限提示、通知關閉與休眠喚醒另以原生操作驗證；撤回權限則透過模擬器的系統 AppOps／permission 操作驗證。

2026-10-18 已在 API 35 模擬器完成上述手勢與生命週期驗證：浮窗外可點擊桌面並開啟 Gallery；通知可收合／關閉；拒絕通知仍能開啟浮窗；撤回浮窗權限會移除浮窗；休眠時隱藏、未設鎖屏的喚醒後恢復。建置、3 項幾何測試（含 5,000 組邊界）、Lint 與 APK 簽章檢查通過，Lint 為 0 錯誤、13 項警告。APK 的 18 個離線資料檔均與生成來源雜湊一致，所有 PNG 可解碼。使用者也已回報手機測試正常，機型與 Android 版本未記錄；這不代表 Android 8–16 每個版本、手機廠牌省電機制或所有遊戲實機都已驗證。

正式發行前需使用持續保存的正式簽章金鑰；更換簽章將無法覆蓋安裝此測試版。金鑰不放入專案或 APK 交付資料夾。
