//! Window-only capture. No game memory, input hooks, or automatic key presses.
use std::{path::Path, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::{Duration, SystemTime, UNIX_EPOCH}, thread::{self, JoinHandle}};
use base64::{Engine, engine::general_purpose::STANDARD};
use crate::capture_timing::{MapKeyTrigger, BURST_MS, CAPTURE_GAP_MS, KEY_POLL_MS};
use crate::capture_region::{crop_bounds, valid_region, TRACKING_GAP_MS};
use image::{DynamicImage, RgbaImage, codecs::jpeg::JpegEncoder};
use serde::Serialize;
use tauri::State;
use windows_capture::{capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    frame::Frame, graphics_capture_api::InternalCaptureControl, settings::*, window::Window};
use windows_sys::Win32::{Foundation::CloseHandle,
    System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    UI::{WindowsAndMessaging::{IsIconic, GetForegroundWindow}, Input::KeyboardAndMouse::{GetAsyncKeyState, VK_M}}};

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedFrame { pub sequence: u64, pub captured_at: u64, pub width: u32, pub height: u32, pub image: String, pub source_region: [f64; 4] }
#[derive(Default)]
struct Shared { requested: AtomicBool, closed: AtomicBool, frame: Mutex<Option<CapturedFrame>>, error: Mutex<Option<String>>,
    monitor_stop: AtomicBool, burst_until: AtomicU64, map_key_at: AtomicU64,
    fast: AtomicBool, watch_map: AtomicBool, crop: Mutex<Option<[f64; 4]>> }
struct Handler { shared: Arc<Shared>, sequence: u64, last_capture: u64 }
impl GraphicsCaptureApiHandler for Handler {
    type Flags = Arc<Shared>;
    type Error = String;
    fn new(ctx: Context<Self::Flags>) -> Result<Self, String> { Ok(Self { shared: ctx.flags, sequence: 0, last_capture: 0 }) }
    fn on_frame_arrived(&mut self, frame: &mut Frame<'_>, control: InternalCaptureControl) -> Result<(), String> {
        let now = now_ms();
        let gap = if self.shared.fast.load(Ordering::Relaxed) { TRACKING_GAP_MS } else { CAPTURE_GAP_MS };
        if now.saturating_sub(self.last_capture) < gap { return Ok(()); }
        let requested = self.shared.requested.swap(false, Ordering::Relaxed);
        if !requested && now >= self.shared.burst_until.load(Ordering::Relaxed) { return Ok(()); }
        self.last_capture = now;
        let result = (|| -> Result<CapturedFrame, String> {
            let buffer = frame.buffer_without_title_bar().map_err(|e| e.to_string())?;
            let (w,h) = (buffer.width(), buffer.height());
            if w == 0 || h == 0 || w > 16384 || h > 16384 { return Err("遊戲畫面尺寸無效。".into()); }
            let mut padded = Vec::new();
            let region = *self.shared.crop.lock().map_err(|e| e.to_string())?;
            let (x, y, cw, ch) = crop_bounds(w, h, region);
            let pixels = buffer.as_nopadding_buffer(&mut padded);
            let mut cropped = Vec::with_capacity((cw * ch * 4) as usize);
            for row in y..y + ch {
                let start = ((row * w + x) * 4) as usize;
                cropped.extend_from_slice(&pixels[start..start + (cw * 4) as usize]);
            }
            let rgba = RgbaImage::from_raw(cw, ch, cropped).ok_or("無法讀取擷取畫面。")?;
            let mut image = DynamicImage::ImageRgba8(rgba);
            if cw > 1920 || ch > 1200 { image = image.resize(1920, 1200, image::imageops::FilterType::Triangle); }
            let rgb = image.to_rgb8();
            let mut jpeg = Vec::new();
            JpegEncoder::new_with_quality(&mut jpeg, 90).encode_image(&rgb).map_err(|e| e.to_string())?;
            self.sequence += 1;
            Ok(CapturedFrame { sequence: self.sequence, captured_at: now, width: rgb.width(), height: rgb.height(),
                source_region: [x as f64 / w as f64, y as f64 / h as f64, cw as f64 / w as f64, ch as f64 / h as f64],
                image: format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)) })
        })();
        match result {
            Ok(frame) => { *self.shared.frame.lock().map_err(|e| e.to_string())? = Some(frame); }
            Err(error) => { *self.shared.error.lock().map_err(|e| e.to_string())? = Some(error); self.shared.closed.store(true, Ordering::Relaxed); control.stop(); }
        }
        Ok(())
    }
    fn on_closed(&mut self) -> Result<(), String> { self.shared.closed.store(true, Ordering::Relaxed); Ok(()) }
}
type Control = CaptureControl<Handler, String>;
struct Session { control: Control, shared: Arc<Shared>, handle: usize, monitor: JoinHandle<()> }
impl Session {
    fn stop(self) -> Result<(), String> {
        self.shared.monitor_stop.store(true, Ordering::Relaxed);
        let _ = self.monitor.join();
        self.control.stop().map_err(|e| e.to_string())
    }
}
#[derive(Default, Clone)]
pub struct CaptureState(Arc<Mutex<Option<Session>>>);
impl CaptureState {
    pub fn shutdown(&self) {
        if let Ok(mut session) = self.0.lock() {
            if let Some(session) = session.take() { let _ = session.stop(); }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameWindow { id: String, title: String }

// PROCESS_QUERY_LIMITED_INFORMATION suffices to identify the owning executable.
// Do not use the library's process_name(), which unnecessarily requests VM_READ.
fn is_game(window: &Window) -> bool {
    let Ok(pid) = window.process_id() else { return false };
    if pid == std::process::id() { return false; }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() { return false; }
        let mut buffer = [0u16; 32768]; let mut len = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 { return false; }
        let path = String::from_utf16_lossy(&buffer[..len as usize]);
        Path::new(&path).file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("Aniimo.exe"))
    }
}

#[tauri::command]
pub fn game_windows() -> Result<Vec<GameWindow>, String> {
    Ok(Window::enumerate().map_err(|e| e.to_string())?.into_iter().filter(is_game).map(|w|
        GameWindow { id: (w.as_raw_hwnd() as usize).to_string(), title: w.title().unwrap_or_else(|_| "伊莫".into()) }).collect())
}

#[derive(Clone, Copy)]
pub struct GameTarget { handle: usize, process_id: u32 }
impl GameTarget {
    pub fn valid(&self) -> bool {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, GetWindowThreadProcessId};
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(self.handle as _, &mut pid); }
        unsafe { IsWindow(self.handle as _) != 0 && pid == self.process_id }
    }
    pub fn bounds(&self) -> Option<(i32, i32, u32, u32)> {
        use windows_sys::Win32::{Foundation::{POINT, RECT}, Graphics::Gdi::ClientToScreen,
            UI::WindowsAndMessaging::{GetClientRect, IsWindowVisible}};
        let handle = self.handle as _;
        let mut rect: RECT = unsafe { std::mem::zeroed() };
        let mut origin = POINT { x: 0, y: 0 };
        if !self.valid() || unsafe { IsIconic(handle) != 0 || IsWindowVisible(handle) == 0
            || GetClientRect(handle, &mut rect) == 0 || ClientToScreen(handle, &mut origin) == 0 } { return None; }
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        (w > 0 && h > 0).then_some((origin.x, origin.y, w as u32, h as u32))
    }
}

// Resolve once, then query the cached HWND without enumerating processes on every movement.
pub fn find_game_target(selected: Option<&str>) -> Option<GameTarget> {
    let game = Window::enumerate().ok()?.into_iter().find(|w|
        selected.is_none_or(|id| (w.as_raw_hwnd() as usize).to_string() == id) && is_game(w))?;
    Some(GameTarget { handle: game.as_raw_hwnd() as usize, process_id: game.process_id().ok()? })
}

#[tauri::command]
pub async fn start_capture(window_id: String, state: State<'_, CaptureState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        let window = Window::enumerate().map_err(|e| e.to_string())?.into_iter().find(|w|
            (w.as_raw_hwnd() as usize).to_string() == window_id && is_game(w)).ok_or("找不到伊莫視窗，請開啟遊戲後重新整理。")?;
        if let Some(old) = guard.take() { old.stop()?; }
        let shared = Arc::new(Shared::default()); shared.requested.store(true, Ordering::Relaxed);
        shared.watch_map.store(true, Ordering::Relaxed);
        let settings = Settings::new(window, CursorCaptureSettings::WithoutCursor, DrawBorderSettings::Default,
            SecondaryWindowSettings::Default, MinimumUpdateIntervalSettings::Default, DirtyRegionSettings::Default,
            ColorFormat::Rgba8, shared.clone());
        let control = Handler::start_free_threaded(settings).map_err(|e| format!("無法擷取遊戲視窗：{e}"))?;
        let handle = window.as_raw_hwnd() as usize;
        let monitored = shared.clone();
        let monitor = thread::spawn(move || {
            let mut trigger = MapKeyTrigger::default();
            while !monitored.monitor_stop.load(Ordering::Relaxed) && !monitored.closed.load(Ordering::Relaxed) {
                // Query only M, and only while the selected game is foreground. No hook or input injection.
                let foreground = monitored.watch_map.load(Ordering::Relaxed) && unsafe { GetForegroundWindow() as usize == handle };
                let down = foreground && unsafe { GetAsyncKeyState(VK_M as i32) < 0 };
                if trigger.observe(foreground, down) {
                    let now = now_ms();
                    monitored.map_key_at.store(now, Ordering::Relaxed);
                    monitored.burst_until.store(now + BURST_MS, Ordering::Relaxed);
                    monitored.requested.store(true, Ordering::Relaxed);
                }
                thread::sleep(Duration::from_millis(KEY_POLL_MS));
            }
        });
        *guard = Some(Session { control, shared, handle, monitor });
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stop_capture(state: State<'_, CaptureState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(session) = guard.take() { session.stop()?; }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn configure_capture(state: State<'_, CaptureState>, fast: bool, watch_map: bool, region: Option<[f64; 4]>) -> Result<(), String> {
    if region.is_some_and(|r| !valid_region(r)) { return Err("小地圖範圍無效。".into()); }
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = guard.as_ref() {
        *session.shared.crop.lock().map_err(|e| e.to_string())? = region;
        session.shared.fast.store(fast, Ordering::Relaxed);
        session.shared.watch_map.store(watch_map, Ordering::Relaxed);
        if !watch_map { session.shared.burst_until.store(0, Ordering::Relaxed); }
        *session.shared.frame.lock().map_err(|e| e.to_string())? = None;
        session.shared.requested.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureReply { running: bool, message: Option<String>, frame: Option<CapturedFrame>, map_key_at: u64, burst_until: u64 }

#[tauri::command]
pub fn capture_frame(state: State<'_, CaptureState>, after: u64, request_frame: Option<bool>) -> Result<CaptureReply, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(session) = guard.as_ref() else { return Ok(CaptureReply { running: false, message: None, frame: None, map_key_at: 0, burst_until: 0 }); };
    let map_key_at = session.shared.map_key_at.load(Ordering::Relaxed);
    let burst_until = session.shared.burst_until.load(Ordering::Relaxed);
    let error = session.shared.error.lock().map_err(|e| e.to_string())?.clone();
    if session.shared.closed.load(Ordering::Relaxed) || session.control.is_finished() {
        return Ok(CaptureReply { running: false, message: Some(error.unwrap_or("遊戲擷取已結束，請重新連接。".into())), frame: None, map_key_at, burst_until });
    }
    if unsafe { IsIconic(session.handle as _) } != 0 {
        return Ok(CaptureReply { running: true, message: Some("遊戲已最小化，請還原視窗以繼續辨識。".into()), frame: None, map_key_at, burst_until });
    }
    let frame = session.shared.frame.lock().map_err(|e| e.to_string())?.as_ref()
        .filter(|f| f.sequence > after && now_ms().saturating_sub(f.captured_at) < 2000).cloned();
    if request_frame.unwrap_or(true) { session.shared.requested.store(true, Ordering::Relaxed); }
    Ok(CaptureReply { running: true, message: error, frame, map_key_at, burst_until })
}
