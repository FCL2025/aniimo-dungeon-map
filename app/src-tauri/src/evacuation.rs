//! Independent, low-frequency HUD capture. No map worker, keyboard polling, or JPEG IPC.
use std::{sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use image::{DynamicImage, RgbaImage};
use serde::Serialize;
use tauri::State;
use windows_capture::{capture::{CaptureControl, Context, GraphicsCaptureApiHandler}, frame::Frame,
    graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl}, settings::*, window::Window};
use windows_sys::Win32::{UI::WindowsAndMessaging::IsIconic,
    Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT}};
use crate::evacuation_vision::{Confirmation, Detector, INTERVAL_MS, MIN_INTERVAL_MS, ROI};

static SOUND: &[u8] = include_bytes!("../../sounds/evacuation-complete.wav");
fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    state: String, samples: u64, matched: bool, audio_failed: bool,
    elapsed_ms: u128, sampled_at: u64, error: Option<String>,
}
impl Report {
    fn new(state: &str) -> Self { Self { state: state.into(), samples: 0, matched: false,
        audio_failed: false, elapsed_ms: 0, sampled_at: 0, error: None } }
}
struct Shared { report: Mutex<Report>, cancelled: AtomicBool, reset: AtomicBool }
struct Flags { shared: Arc<Shared>, window: Window }
struct Handler { shared: Arc<Shared>, window: Window, detector: Detector, confirmation: Confirmation, last_capture: Option<Instant> }
impl GraphicsCaptureApiHandler for Handler {
    type Flags = Flags;
    type Error = String;
    fn new(ctx: Context<Flags>) -> Result<Self, String> {
        Ok(Self { shared: ctx.flags.shared, window: ctx.flags.window, detector: Detector::new(),
            confirmation: Confirmation::default(), last_capture: None })
    }
    fn on_frame_arrived(&mut self, frame: &mut Frame<'_>, control: InternalCaptureControl) -> Result<(), String> {
        if self.shared.cancelled.load(Ordering::SeqCst) { control.stop(); return Ok(()); }
        if self.shared.reset.swap(false, Ordering::Relaxed) { self.confirmation.reset(); }
        if unsafe { IsIconic(self.window.as_raw_hwnd() as _) } != 0 {
            self.confirmation.reset();
            self.shared.report.lock().map_err(|e| e.to_string())?.state = "paused".into();
            return Ok(());
        }
        if self.last_capture.is_some_and(|last| last.elapsed() < Duration::from_millis(MIN_INTERVAL_MS)) { return Ok(()); }
        let started = Instant::now();
        self.last_capture = Some(started);
        let now = now_ms();
        let result = (|| {
            let title = self.window.title_bar_height().map_err(|e| e.to_string())?;
            let height = frame.height().checked_sub(title).filter(|h| *h >= 480).ok_or("遊戲畫面尺寸無效。")?;
            let scale = height as f64 / 1080.0;
            let x = (ROI[0] as f64 * scale).round() as u32;
            let y = (ROI[1] as f64 * scale).round() as u32 + title;
            let right = ((ROI[0]+ROI[2]) as f64 * scale).round() as u32;
            let bottom = ((ROI[1]+ROI[3]) as f64 * scale).round() as u32 + title;
            if right > frame.width() || bottom > frame.height() { return Err("遊戲畫面尺寸無效。".to_string()); }
            // Crop on the GPU first: at 1080p only a 400×220 HUD region reaches the CPU.
            let buffer = frame.buffer_crop(x,y,right,bottom).map_err(|e| e.to_string())?;
            let mut padded = Vec::new();
            let pixels = buffer.as_nopadding_buffer(&mut padded).to_vec();
            let rgba = RgbaImage::from_raw(right-x,bottom-y,pixels).ok_or("無法讀取擷取畫面。")?;
            Ok(self.detector.inspect(&DynamicImage::ImageRgba8(rgba).into_luma8()))
        })();
        let mut report = self.shared.report.lock().map_err(|e| e.to_string())?;
        if self.shared.cancelled.load(Ordering::SeqCst) { control.stop(); return Ok(()); }
        report.sampled_at = now;
        report.elapsed_ms = started.elapsed().as_millis();
        match result {
            Ok(matched) => {
                report.samples += 1;
                report.matched = matched;
                report.state = "watching".into();
                if self.confirmation.observe(matched, now) {
                    report.state = "completed".into();
                    // Static bytes outlive asynchronous playback; no dependency on WebView visibility/autoplay.
                    report.audio_failed = unsafe { PlaySoundW(SOUND.as_ptr().cast(), std::ptr::null_mut(), SND_MEMORY | SND_ASYNC | SND_NODEFAULT) } == 0;
                    control.stop();
                }
            }
            Err(error) => { report.state = "error".into(); report.error = Some(error); control.stop(); }
        }
        Ok(())
    }
    fn on_closed(&mut self) -> Result<(), String> {
        let mut report = self.shared.report.lock().map_err(|e| e.to_string())?;
        if report.state != "completed" && !self.shared.cancelled.load(Ordering::SeqCst) {
            report.state = "error".into(); report.error = Some("遊戲擷取已結束，請重新連接。".into());
        }
        Ok(())
    }
}

struct Session { control: CaptureControl<Handler, String>, shared: Arc<Shared>, handle: usize }
impl Session {
    fn stop(self) { self.shared.cancelled.store(true, Ordering::SeqCst); let _ = self.control.stop(); }
}
#[derive(Clone, Default)]
pub struct EvacuationState(Arc<Mutex<Option<Session>>>);
impl EvacuationState {
    pub fn shutdown(&self) { if let Ok(mut session) = self.0.lock() { if let Some(session) = session.take() { session.stop(); } } }
}

#[tauri::command]
pub async fn start_evacuation(window_id: Option<String>, state: State<'_, EvacuationState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(old) = guard.take() { old.stop(); }
        let window = Window::enumerate().map_err(|e| e.to_string())?.into_iter().find(|w|
            window_id.as_ref().is_none_or(|id| (w.as_raw_hwnd() as usize).to_string() == *id) && crate::capture::is_game(w))
            .ok_or("找不到伊莫遊戲主視窗，請進入遊戲後重新整理並重新開啟辨識。")?;
        let shared = Arc::new(Shared { report: Mutex::new(Report::new("watching")), cancelled: AtomicBool::new(false), reset: AtomicBool::new(false) });
        // Older Windows versions lack MinUpdateInterval; the callback still enforces the same CPU cadence.
        let interval = if GraphicsCaptureApi::is_minimum_update_interval_supported().unwrap_or(false) {
            MinimumUpdateIntervalSettings::Custom(Duration::from_millis(INTERVAL_MS))
        } else { MinimumUpdateIntervalSettings::Default };
        let settings = Settings::new(window, CursorCaptureSettings::WithoutCursor, DrawBorderSettings::Default,
            SecondaryWindowSettings::Default, interval, DirtyRegionSettings::Default, ColorFormat::Rgba8,
            Flags { shared: shared.clone(), window });
        let control = Handler::start_free_threaded(settings).map_err(|e| format!("無法擷取遊戲視窗：{e}"))?;
        *guard = Some(Session { control, shared, handle: window.as_raw_hwnd() as usize });
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stop_evacuation(state: State<'_, EvacuationState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.shutdown()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn evacuation_status(state: State<'_, EvacuationState>) -> Result<Report, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(session) = guard.as_ref() else { return Ok(Report::new("idle")); };
    let mut report = session.shared.report.lock().map_err(|e| e.to_string())?;
    if report.state == "watching" || report.state == "paused" {
        if session.control.is_finished() {
            report.state = "error".into(); report.error = Some("遊戲擷取已結束，請重新連接。".into());
        } else if unsafe { IsIconic(session.handle as _) } != 0 {
            report.state = "paused".into(); session.shared.reset.store(true, Ordering::Relaxed);
        }
    }
    Ok(report.clone())
}
