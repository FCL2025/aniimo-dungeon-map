use std::path::PathBuf;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub struct OverlayConfig {
    pub profile: PathBuf,
    pub hidden: bool,
    pub browser_args: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    game_found: bool,
}

fn placement(x: i32, y: i32, width: u32, height: u32, game_found: bool) -> Placement {
    let w = 448.min(width);
    let h = 464.min(height);
    Placement {
        x: x + 4.min(width.saturating_sub(w)) as i32,
        y: y + ((height as f64 * 496.0 / 1080.0).round() as u32).min(height.saturating_sub(h))
            as i32,
        width: w,
        height: h,
        game_found,
    }
}

// Creating a WebView2 window from an IPC command must run asynchronously on Windows.
#[tauri::command]
pub async fn set_map_overlay(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
    game_window_id: Option<String>,
) -> Result<Option<Placement>, String> {
    if !enabled {
        if let Some(overlay) = app.get_webview_window("map-overlay") {
            overlay.close().map_err(|e| e.to_string())?;
        }
        return Ok(None);
    }
    let target =
        if let Some((x, y, w, h)) = crate::capture::game_client_bounds(game_window_id.as_deref()) {
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
        return Ok(Some(target));
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
        if !config.hidden {
            overlay.show().map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = overlay.close();
        return Err(error);
    }
    Ok(Some(target))
}

#[tauri::command]
pub fn drag_window(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_hd_matches_the_requested_rectangle() {
        let p = placement(0, 0, 1920, 1080, true);
        assert_eq!((p.x, p.y, p.width, p.height), (4, 496, 448, 464));
    }
    #[test]
    fn positions_are_relative_to_the_game_not_the_primary_monitor() {
        let p = placement(-1920, 80, 1920, 1080, true);
        assert_eq!((p.x, p.y), (-1916, 576));
    }
    #[test]
    fn small_window_stays_inside_client_area() {
        let p = placement(30, 50, 400, 300, true);
        assert_eq!((p.x, p.y, p.width, p.height), (30, 50, 400, 300));
    }
}
