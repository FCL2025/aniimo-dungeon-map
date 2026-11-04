use std::{fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}, sync::Mutex};
use tauri::State;

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
pub struct TrackingLogState { root: PathBuf, lock: Mutex<()> }
impl TrackingLogState {
    pub fn new(root: PathBuf) -> Self { Self { root, lock: Mutex::new(()) } }
}

#[tauri::command]
pub fn append_tracking_log(state: State<'_, TrackingLogState>, entry: serde_json::Value) -> Result<String, String> {
    let line = serde_json::to_string(&serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"entry":entry})).map_err(|e|e.to_string())?;
    if line.len() > 32768 { return Err("追蹤診斷紀錄過長".into()); }
    let _guard = state.lock.lock().map_err(|e|e.to_string())?;
    append_line(&state.root, &line)
}

fn append_line(root: &Path, line: &str) -> Result<String, String> {
    let folder = root.join("logs");
    fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
    let path = folder.join("tracking.log");
    if path.metadata().is_ok_and(|m|m.len()+line.len() as u64+1>MAX_LOG_BYTES) {
        let previous = folder.join("tracking.log.1");
        if previous.exists() { fs::remove_file(&previous).map_err(|e|e.to_string())?; }
        fs::rename(&path, previous).map_err(|e|e.to_string())?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(&path).map_err(|e|e.to_string())?;
    writeln!(file, "{line}").map_err(|e|e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rotates_tracking_log_and_preserves_other_files() {
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root=std::env::temp_dir().join(format!("aniimo-tracking-log-{}-{stamp}",std::process::id()));
        let path=append_line(&root,"{\"event\":\"start\"}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(),"{\"event\":\"start\"}\n");
        fs::write(root.join("logs/recognition.log"),"untouched").unwrap();
        fs::write(&path,"x".repeat(MAX_LOG_BYTES as usize)).unwrap();
        append_line(&root,"{\"event\":\"no-frame\"}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(),"{\"event\":\"no-frame\"}\n");
        assert_eq!(fs::metadata(root.join("logs/tracking.log.1")).unwrap().len(),MAX_LOG_BYTES);
        assert_eq!(fs::read_to_string(root.join("logs/recognition.log")).unwrap(),"untouched");
        fs::write(&path,"y".repeat(MAX_LOG_BYTES as usize)).unwrap();
        append_line(&root,"{}").unwrap();
        assert!(fs::read_to_string(root.join("logs/tracking.log.1")).unwrap().starts_with('y'));
        fs::remove_dir_all(root).unwrap();
    }
}
