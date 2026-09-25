#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, sync::Mutex};
use tauri::{LogicalSize, PhysicalSize, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Manager};
mod capture;
mod capture_timing;

#[derive(Default)]
struct WindowState {
    expanded_size: Mutex<Option<PhysicalSize<u32>>>,
}

#[tauri::command]
fn set_topmost(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    window.is_always_on_top().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_compact(window: WebviewWindow, state: State<WindowState>, enabled: bool) -> Result<(), String> {
    let mut saved = state.expanded_size.lock().map_err(|e| e.to_string())?;
    if enabled {
        if saved.is_none() {
            *saved = Some(window.inner_size().map_err(|e| e.to_string())?);
        }
        window.set_size(LogicalSize::new(600.0, 560.0)).map_err(|e| e.to_string())?;
    } else if let Some(size) = saved.take() {
        window.set_size(size).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    let result = tauri::Builder::default()
        .manage(WindowState::default())
        .manage(capture::CaptureState::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.state::<capture::CaptureState>().shutdown();
            }
        })
        .invoke_handler(tauri::generate_handler![set_topmost, set_compact, capture::game_windows,
            capture::start_capture, capture::stop_capture, capture::capture_frame])
        .setup(|app| {
            let exe = std::env::current_exe()?;
            let folder = exe.parent().ok_or("Cannot find executable directory")?;
            let profile = folder.join("Data").join("WebView2");
            fs::create_dir_all(&profile)?;
            let hidden = std::env::args().any(|a| a == "--hidden");
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
            if hidden {
                if let Ok(args) = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
                    window = window.additional_browser_args(&format!(
                        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required {args}"
                    ));
                }
            }
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        let message = format!(
            "無法啟動伊莫地城地圖。\n\n請確認 EXE 已解壓至可寫入的資料夾，且系統已安裝 Microsoft Edge WebView2 Runtime。\n\n錯誤：{error}"
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
