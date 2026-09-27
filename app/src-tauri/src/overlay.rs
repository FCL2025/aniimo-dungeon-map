use std::{path::PathBuf, sync::{Arc, Mutex, mpsc, atomic::{AtomicBool, Ordering}}, thread::JoinHandle, time::{Duration, Instant}};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub struct OverlayConfig {
    pub profile: PathBuf,
    pub hidden: bool,
    pub browser_args: Option<String>,
}

#[derive(Default)]
pub struct FollowState(Mutex<Option<(Arc<AtomicBool>, JoinHandle<()>)>>);
impl FollowState {
    pub fn stop(&self) {
        if let Ok(mut current) = self.0.lock() {
            if let Some((stop, worker)) = current.take() {
                stop.store(true, Ordering::Relaxed);
                // Release F1 on its registering thread before another overlay opens.
                let _ = worker.join();
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    game_found: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayOpened {
    #[serde(flatten)]
    placement: Placement,
    hotkey_error: Option<String>,
}

fn should_show_overlay(test_hidden: bool, paused: bool, attached: bool, game_visible: bool) -> bool {
    !test_hidden && !paused && (!attached || game_visible)
}

fn placement(x: i32, y: i32, width: u32, height: u32, game_found: bool) -> Placement {
    // Match the lower-left play area at Full HD and 2560 × 1440, and scale
    // intermediate sizes while staying inside a smaller game client.
    let factor = (width as f64 / 1920.0).min(height as f64 / 1080.0);
    let side = (590.0 + (factor.max(1.0) - 1.0) * 600.0).round() as u32;
    let side = side.min(width).min(height);
    Placement {
        x: x + 4.min(width.saturating_sub(side)) as i32,
        y: y + height.saturating_sub(side).saturating_sub(4) as i32,
        width: side,
        height: side,
        game_found,
    }
}

fn follow_placement(bounds: (i32, i32, u32, u32), offset: Option<(i32, i32)>) -> Placement {
    let (x, y, w, h) = bounds;
    let mut target = placement(x, y, w, h, true);
    if let Some((dx, dy)) = offset {
        target.x = x + dx.clamp(0, w.saturating_sub(target.width) as i32);
        target.y = y + dy.clamp(0, h.saturating_sub(target.height) as i32);
    }
    target
}

fn start_following(app: &AppHandle, overlay: &WebviewWindow, mut game: Option<crate::capture::GameTarget>,
    selected: Option<String>, initial: Placement, hidden: bool) -> Result<Option<String>, String> {
    use windows_sys::Win32::{Foundation::RECT, UI::{WindowsAndMessaging::*,
        Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT, VK_F1}}};
    let hwnd = overlay.hwnd().map_err(|e| e.to_string())?.0 as usize;
    let owner_thread = unsafe { GetWindowThreadProcessId(hwnd as _, std::ptr::null_mut()) };
    let state = app.state::<FollowState>();
    state.stop();
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();
    let app_handle = app.clone();
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let worker = std::thread::Builder::new().name("overlay-follow".into()).spawn(move || {
        const HOTKEY_ID: i32 = 0x414e;
        // Thread-owned global hotkey; no hooks and no dependency on WebView focus.
        let registered = unsafe { RegisterHotKey(std::ptr::null_mut(), HOTKEY_ID, MOD_NOREPEAT, VK_F1 as u32) } != 0;
        let hotkey_error = (!registered).then(|| format!("F1 無法使用，可能已被其他程式占用（{}）。仍可用「地圖模式」或 × 關閉覆蓋地圖。", std::io::Error::last_os_error()));
        let _ = ready_tx.send(hotkey_error);
        let mut paused = false;
        let mut last_scan = Instant::now() - Duration::from_secs(1);
        let mut offset = None;
        let mut previous_dragging = false;
        let mut attached = game.is_some();
        let mut shown = !hidden && (game.is_none() || initial.game_found);
        let mut last = Some(initial);
        while !worker_stop.load(Ordering::Relaxed) && unsafe { IsWindow(hwnd as _) } != 0 {
            let mut message: MSG = unsafe { std::mem::zeroed() };
            while unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), WM_HOTKEY, WM_HOTKEY, PM_REMOVE) } != 0 {
                if registered && message.wParam == HOTKEY_ID as usize {
                    paused = !paused;
                    let _ = app_handle.emit_to("main", "map-overlay-paused", paused);
                }
            }
            if game.is_some_and(|g| !g.valid()) { game = None; }
            if game.is_none() && last_scan.elapsed() >= Duration::from_secs(1) {
                game = crate::capture::find_game_target(selected.as_deref())
                    .or_else(|| crate::capture::find_game_target(None));
                last_scan = Instant::now();
            }
            attached |= game.is_some();
            let bounds = game.and_then(|g| g.bounds());
            let should_show = should_show_overlay(hidden, paused, attached, bounds.is_some());
            if let Some(bounds) = bounds {
                let mut gui: GUITHREADINFO = unsafe { std::mem::zeroed() };
                gui.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
                let dragging = unsafe { GetGUIThreadInfo(owner_thread, &mut gui) != 0 }
                    && gui.flags & GUI_INMOVESIZE != 0 && gui.hwndMoveSize as usize == hwnd;
                if dragging || previous_dragging {
                    let mut rect: RECT = unsafe { std::mem::zeroed() };
                    if unsafe { GetWindowRect(hwnd as _, &mut rect) } != 0 {
                        offset = Some((rect.left - bounds.0, rect.top - bounds.1));
                    }
                    last = None;
                }
                if !dragging {
                    let target = follow_placement(bounds, offset);
                    if last != Some(target) {
                        let mut flags = SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS;
                        if last.is_some_and(|p| (p.width, p.height) == (target.width, target.height)) { flags |= SWP_NOSIZE; }
                        if unsafe { SetWindowPos(hwnd as _, std::ptr::null_mut(), target.x, target.y,
                            target.width as i32, target.height as i32, flags) } != 0 { last = Some(target); }
                    }
                }
                previous_dragging = dragging;
            }
            if shown != should_show {
                unsafe { ShowWindowAsync(hwnd as _, if should_show { SW_SHOWNOACTIVATE } else { SW_HIDE }); }
                shown = should_show;
            }
            // Visibility and geometry do not reload the WebView or change capture/tracking.
            std::thread::sleep(Duration::from_millis(16));
        }
        if registered { unsafe { UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID); } }
    }).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some((stop, worker));
    ready_rx.recv().map_err(|e| e.to_string())
}

// Creating a WebView2 window from an IPC command must run asynchronously on Windows.
#[tauri::command]
pub async fn set_map_overlay(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
    game_window_id: Option<String>,
) -> Result<Option<OverlayOpened>, String> {
    if !enabled {
        app.state::<FollowState>().stop();
        if let Some(overlay) = app.get_webview_window("map-overlay") {
            overlay.close().map_err(|e| e.to_string())?;
        }
        return Ok(None);
    }
    let game = crate::capture::find_game_target(game_window_id.as_deref())
        .or_else(|| crate::capture::find_game_target(None));
    let target =
        if let Some((x, y, w, h)) = game.and_then(|g| g.bounds()) {
            placement(x, y, w, h, true)
        } else {
            let monitor = window
                .current_monitor()
                .map_err(|e| e.to_string())?
                .or(window.primary_monitor().map_err(|e| e.to_string())?)
                .ok_or("找不到螢幕")?;
            placement(
                monitor.position().x,
                monitor.position().y,
                monitor.size().width,
                monitor.size().height,
                false,
            )
        };
    if app.get_webview_window("map-overlay").is_some() {
        return Ok(Some(OverlayOpened { placement: target, hotkey_error: None }));
    }
    let config = app.state::<OverlayConfig>();
    let mut builder =
        WebviewWindowBuilder::new(&app, "map-overlay", WebviewUrl::App("overlay.html".into()))
            .title("伊莫地圖 · 覆蓋視窗")
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .visible(false)
            .data_directory(config.profile.clone())
            .disable_drag_drop_handler();
    if let Some(args) = &config.browser_args {
        builder = builder.additional_browser_args(args);
    }
    let overlay = builder.build().map_err(|e| e.to_string())?;
    let result = (|| {
        overlay
            .set_size(PhysicalSize::new(target.width, target.height))
            .map_err(|e| e.to_string())?;
        overlay
            .set_position(PhysicalPosition::new(target.x, target.y))
            .map_err(|e| e.to_string())?;
        if !config.hidden && (game.is_none() || target.game_found) {
            overlay.show().map_err(|e| e.to_string())?;
        }
        start_following(&app, &overlay, game, game_window_id, target, config.hidden)
    })();
    match result {
        Ok(hotkey_error) => Ok(Some(OverlayOpened { placement: target, hotkey_error })),
        Err(error) => {
            app.state::<FollowState>().stop();
            let _ = overlay.close();
            Err(error)
        }
    }
}

#[tauri::command]
pub fn drag_window(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_hide_survives_game_minimize_restore_and_reconnect() {
        for (attached, visible) in [(false, false), (true, false), (true, true)] {
            assert!(!should_show_overlay(false, true, attached, visible));
        }
        assert!(should_show_overlay(false, false, true, true));
        assert!(!should_show_overlay(false, false, true, false));
        assert!(should_show_overlay(false, false, false, false));
        assert!(!should_show_overlay(true, false, true, true));
    }
    #[test]
    fn full_hd_matches_the_requested_rectangle() {
        let p = placement(0, 0, 1920, 1080, true);
        assert_eq!((p.x, p.y, p.width, p.height), (4, 486, 590, 590));
    }
    #[test]
    fn two_k_switches_to_the_larger_square() {
        let p = placement(0, 0, 2560, 1440, true);
        assert_eq!((p.x, p.y, p.width, p.height), (4, 646, 790, 790));
        let resized = follow_placement((0, 0, 2560, 1440), None);
        assert_eq!(resized, p);
        assert_eq!(follow_placement((0, 0, 1920, 1080), None).width, 590);
    }
    #[test]
    fn positions_are_relative_to_the_game_not_the_primary_monitor() {
        let p = placement(-1920, 80, 1920, 1080, true);
        assert_eq!((p.x, p.y), (-1916, 566));
    }
    #[test]
    fn small_window_stays_inside_client_area() {
        let p = placement(30, 50, 400, 300, true);
        assert_eq!((p.x, p.y, p.width, p.height), (34, 50, 300, 300));
    }
    #[test]
    fn follows_game_movement_across_monitors() {
        let a = follow_placement((100, 60, 1920, 1080), None);
        let b = follow_placement((-1700, 180, 1920, 1080), None);
        assert_eq!((b.x - a.x, b.y - a.y), (-1800, 120));
        assert_eq!((a.width, a.height), (b.width, b.height));
    }
    #[test]
    fn manual_offset_is_preserved_and_clamped_when_resized() {
        let moved = follow_placement((100, 200, 1920, 1080), Some((80, 400)));
        assert_eq!((moved.x, moved.y), (180, 600));
        let small = follow_placement((100, 200, 500, 500), Some((80, 400)));
        assert_eq!((small.x, small.y), (100, 200));
        let restored = follow_placement((100, 200, 1920, 1080), Some((80, 400)));
        assert_eq!(restored, moved);
    }
}
