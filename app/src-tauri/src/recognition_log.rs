use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

const MAX_LOG_BYTES: u64 = 1024 * 1024;

pub struct RecognitionLogState {
    root: PathBuf,
    lock: Mutex<()>,
}

impl RecognitionLogState {
    pub fn new(root: PathBuf) -> Self {
        Self { root, lock: Mutex::new(()) }
    }
}

#[tauri::command]
pub fn append_recognition_log(
    state: State<'_, RecognitionLogState>,
    entry: serde_json::Value,
) -> Result<String, String> {
    let line = serde_json::to_string(&serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "entry": entry,
    })).map_err(|e| e.to_string())?;
    if line.len() > 8192 { return Err("辨識診斷紀錄過長".into()); }
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    append_line(&state.root,&line)
}

fn append_line(root: &Path, line: &str) -> Result<String, String> {
    let folder = root.join("logs");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join("recognition.log");
    if path.metadata().is_ok_and(|m| m.len() + line.len() as u64 + 1 > MAX_LOG_BYTES) {
        let previous = folder.join("recognition.log.1");
        if previous.exists() { fs::remove_file(&previous).map_err(|e| e.to_string())?; }
        fs::rename(&path, previous).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn writes_readable_entries_and_rotates_at_one_megabyte() {
        let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root=std::env::temp_dir().join(format!("aniimo-recognition-log-test-{}-{stamp}",std::process::id()));
        let path=append_line(&root,"{\"event\":\"slow\"}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(),"{\"event\":\"slow\"}\n");
        fs::write(&path,"x".repeat(MAX_LOG_BYTES as usize)).unwrap();
        append_line(&root,"{\"event\":\"failure\"}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(),"{\"event\":\"failure\"}\n");
        assert_eq!(fs::metadata(root.join("logs/recognition.log.1")).unwrap().len(),MAX_LOG_BYTES);
        fs::remove_dir_all(root).unwrap();
    }
}
