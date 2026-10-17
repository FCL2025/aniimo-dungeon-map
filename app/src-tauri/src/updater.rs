use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
    can_install: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<AvailableUpdate>, String> {
    // Hidden launches are isolated smoke tests and should never contact a release server.
    if std::env::args().any(|arg| arg == "--hidden") {
        return Ok(None);
    }
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    Ok(update.map(|update| AvailableUpdate {
        version: update.version,
        notes: update.body,
        can_install: cfg!(feature = "installer"),
    }))
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    if !cfg!(feature = "installer") {
        return Err("This portable build cannot install updates in place.".into());
    }
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or("No newer release is available.")?;
    let mut downloaded_bytes = 0_u64;
    let progress_app = app.clone();
    let bytes = update
        .download(
            move |chunk, total_bytes| {
                downloaded_bytes += chunk as u64;
                let _ = progress_app.emit_to(
                    "main",
                    "update-download-progress",
                    DownloadProgress {
                        downloaded_bytes,
                        total_bytes,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(false);
    }
    // On Windows Tauri launches the verified installer, exits this process,
    // and lets the installer relaunch the installed app when it finishes.
    update.install(bytes).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_portable_download() -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    const URL: &str = "https://github.com/FCL2025/aniimo-dungeon-map/releases/latest/download/AniimoDungeonMap.exe";
    let url: Vec<u16> = URL.encode_utf16().chain(Some(0)).collect();
    let open: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            open.as_ptr(),
            url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err("Could not open the download page.".into());
    }
    Ok(())
}
