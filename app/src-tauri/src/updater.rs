use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use std::time::Duration;

const LATEST_RELEASE: &str = "https://api.github.com/repos/FCL2025/aniimo-dungeon-map/releases/latest";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
}

fn available_release(release: GitHubRelease) -> Result<Option<AvailableUpdate>, String> {
    let current = Version::parse(env!("CARGO_PKG_VERSION")).map_err(|error| error.to_string())?;
    let published = Version::parse(release.tag_name.trim_start_matches('v'))
        .map_err(|error| error.to_string())?;
    Ok((published > current).then(|| AvailableUpdate {
        version: published.to_string(),
        notes: release.body,
    }))
}

#[tauri::command]
pub async fn check_for_update(_app: AppHandle) -> Result<Option<AvailableUpdate>, String> {
    // Hidden launches are isolated smoke tests and should never contact a release server.
    if std::env::args().any(|arg| arg == "--hidden") {
        return Ok(None);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("AniimoDungeonMap/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let release = client
        .get(LATEST_RELEASE)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| error.to_string())?
        .json::<GitHubRelease>()
        .await
        .map_err(|error| error.to_string())?;
    available_release(release)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_portable_release_is_offered_without_an_installer() {
        let release = GitHubRelease { tag_name: "v99.0.0".into(), body: Some("Portable update".into()) };
        let result = available_release(release).unwrap().unwrap();
        assert_eq!(result.version, "99.0.0");
        assert_eq!(result.notes.as_deref(), Some("Portable update"));
    }

    #[test]
    fn current_release_is_not_offered_again() {
        let release = GitHubRelease { tag_name: format!("v{}", env!("CARGO_PKG_VERSION")), body: None };
        assert!(available_release(release).unwrap().is_none());
    }
}
