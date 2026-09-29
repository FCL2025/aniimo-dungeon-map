#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Manager};
mod capture;
mod capture_timing;
mod capture_region;
mod profile;
mod overlay;
mod recognition_log;

#[tauri::command]
fn set_topmost(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    window.is_always_on_top().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_discord() -> Result<(), String> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    // Only this fixed invite can be opened; no shell commands or frontend-supplied URLs.
    let url: Vec<u16> = "https://discord.gg/Yh235uyafn".encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(std::ptr::null_mut(), std::ptr::null(), url.as_ptr(),
            std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL)
    } as isize;
    if result <= 32 { Err(format!("Windows 錯誤碼 {result}")) } else { Ok(()) }
}

fn main() {
    let result = tauri::Builder::default()
        .manage(capture::CaptureState::default())
        .manage(overlay::FollowState::default())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.state::<overlay::FollowState>().stop();
                if let Some(overlay) = window.app_handle().get_webview_window("map-overlay") { let _ = overlay.close(); }
                window.state::<capture::CaptureState>().shutdown();
            }
            if window.label() == "map-overlay" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<overlay::FollowState>().stop();
                let _ = window.app_handle().emit_to("main", "map-overlay-closed", ());
            }
        })
        .invoke_handler(tauri::generate_handler![set_topmost, open_discord, recognition_log::append_recognition_log, overlay::set_map_overlay, overlay::set_overlay_scale, overlay::drag_window, capture::game_windows,
            capture::start_capture, capture::stop_capture, capture::configure_capture, capture::capture_frame])
        .setup(|app| {
            let exe = std::env::current_exe()?;
            let folder = exe.parent().ok_or("Cannot find executable directory")?;
            let hidden = std::env::args().any(|a| a == "--hidden");
            let data_root = if hidden {
                std::env::var_os("ANIIMO_TEST_DATA_DIR").map(std::path::PathBuf::from)
            } else { None }.unwrap_or(app.path().app_local_data_dir()?);
            let profile = data_root.join("WebView2");
            profile::prepare_profile(&profile, folder)?;
            app.manage(recognition_log::RecognitionLogState::new(data_root.clone()));
            let browser_args = hidden.then(|| std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").ok()).flatten()
                .map(|args| format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required {args}"));
            // Diagnostic opt-in for native visibility tests against an offscreen fixture.
            let hide_overlay = hidden && std::env::var_os("ANIIMO_TEST_SHOW_OVERLAY").is_none();
            app.manage(overlay::OverlayConfig { profile: profile.clone(), hidden: hide_overlay, browser_args: browser_args.clone() });
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(concat!("伊莫地城地圖 · 可攜版 ", env!("CARGO_PKG_VERSION")))
                .inner_size(1220.0, 820.0)
                .min_inner_size(460.0, 360.0)
                .center()
                .always_on_top(true)
                .visible(!hidden)
                .data_directory(profile)
                .disable_drag_drop_handler();
            // Explicitly pass diagnostics to WebView2 for hidden smoke tests.
            // Ordinary launches keep the runtime defaults and open no debug port.
            if let Some(args) = browser_args { window = window.additional_browser_args(&args); }
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        let message = format!(
            "無法啟動伊莫地城地圖。\n\n請確認使用者資料夾可寫入，且系統已安裝 Microsoft Edge WebView2 Runtime。首次沿用設定時請先關閉舊版。\n\n錯誤：{error}"
        );
        let body: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "伊莫地城地圖".encode_utf16().chain(Some(0)).collect();
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
            MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR);
        }
        std::process::exit(1);
    }
}
