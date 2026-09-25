use std::{
    fs, io,
    path::{Path, PathBuf},
    time::SystemTime,
};

const STORAGE: &str = "EBWebView/Default/Local Storage/leveldb";

fn legacy_storage(folder: &Path) -> Option<PathBuf> {
    let storage = folder.join("Data/WebView2").join(STORAGE);
    storage.join("CURRENT").is_file().then_some(storage)
}

fn last_saved(storage: &Path) -> SystemTime {
    fs::read_dir(storage)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| {
            matches!(
                entry.path().extension().and_then(|s| s.to_str()),
                Some("log" | "ldb" | "sst")
            )
        })
        .filter_map(|entry| entry.metadata().ok()?.modified().ok())
        .max()
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn find_legacy(folder: &Path) -> Option<PathBuf> {
    // An in-place upgrade or a manually carried Data folder takes precedence.
    if let Some(storage) = legacy_storage(folder) {
        return Some(storage);
    }
    // Search only sibling releases, never unrelated browser profiles or test folders.
    fs::read_dir(folder.parent()?)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.starts_with("AniimoDungeonMap-")
                && name.ends_with("-windows-x64-portable")
                && entry.path().join("AniimoDungeonMap.exe").is_file()
        })
        .filter_map(|entry| legacy_storage(&entry.path()))
        .max_by_key(|storage| last_saved(storage))
}

/// All releases share one profile. Import only localStorage once, leaving old data intact.
pub fn prepare_profile(profile: &Path, exe_folder: &Path) -> io::Result<()> {
    if profile.exists() {
        return Ok(());
    }
    let Some(source) = find_legacy(exe_folder) else {
        return fs::create_dir_all(profile);
    };
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    // Chromium holds LOCK while using LevelDB. Never copy a live database.
    let _lock = options.open(source.join("LOCK")).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!(
                "請先關閉舊版伊莫地城地圖，再開啟新版以沿用設定。無法讀取 {}：{error}",
                source.display()
            ),
        )
    })?;
    let stamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let staging = profile.with_file_name(format!("WebView2-import-{}-{stamp}", std::process::id()));
    let result = (|| {
        let destination = staging.join(STORAGE);
        fs::create_dir_all(&destination)?;
        for entry in fs::read_dir(&source)? {
            let entry = entry?;
            if entry.file_type()?.is_file() && entry.file_name() != "LOCK" {
                fs::copy(entry.path(), destination.join(entry.file_name()))?;
            }
        }
        // Publish only a complete import; errors leave the original profile untouched.
        fs::rename(&staging, profile)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    static NEXT: AtomicU32 = AtomicU32::new(0);

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "aniimo-profile-test-{}-{stamp}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn legacy(&self, name: &str, data: &str) -> PathBuf {
            let folder = self.0.join(name);
            let storage = folder.join("Data/WebView2").join(STORAGE);
            fs::create_dir_all(&storage).unwrap();
            fs::write(folder.join("AniimoDungeonMap.exe"), "fixture").unwrap();
            fs::write(storage.join("CURRENT"), "MANIFEST-000001\n").unwrap();
            fs::write(storage.join("LOCK"), "").unwrap();
            fs::write(storage.join("000003.log"), data).unwrap();
            folder
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn new_install_and_moved_executable_share_the_same_profile() {
        let f = Fixture::new();
        let profile = f.0.join("shared/WebView2");
        prepare_profile(&profile, &f.0.join("first")).unwrap();
        fs::write(profile.join("saved"), "filters").unwrap();
        prepare_profile(&profile, &f.0.join("another-version")).unwrap();
        assert_eq!(
            fs::read_to_string(profile.join("saved")).unwrap(),
            "filters"
        );
    }

    #[test]
    fn imports_sibling_once_without_changing_original_or_copying_cache() {
        let f = Fixture::new();
        let old = f.legacy("AniimoDungeonMap-0.2.2-windows-x64-portable", "old filters");
        fs::write(old.join("Data/WebView2/cache"), "cache").unwrap();
        let profile = f.0.join("shared/WebView2");
        prepare_profile(&profile, &f.0.join("new-release")).unwrap();
        assert_eq!(
            fs::read_to_string(profile.join(STORAGE).join("000003.log")).unwrap(),
            "old filters"
        );
        assert!(!profile.join("cache").exists());
        assert!(!profile.join(STORAGE).join("LOCK").exists());
        assert!(legacy_storage(&old).unwrap().join("LOCK").exists());
        fs::write(profile.join(STORAGE).join("000003.log"), "new filters").unwrap();
        prepare_profile(&profile, &old).unwrap();
        assert_eq!(
            fs::read_to_string(profile.join(STORAGE).join("000003.log")).unwrap(),
            "new filters"
        );
    }

    #[test]
    fn local_data_precedes_siblings_and_unrelated_folders_are_ignored() {
        let f = Fixture::new();
        let local = f.legacy("new-release", "local");
        let sibling = f.legacy("AniimoDungeonMap-0.2.2-windows-x64-portable", "sibling");
        f.legacy("smoke-run", "test settings");
        assert_eq!(find_legacy(&local), legacy_storage(&local));
        assert_eq!(find_legacy(&f.0.join("fresh")), legacy_storage(&sibling));
    }

    #[test]
    fn chooses_most_recent_settings_instead_of_highest_version() {
        let f = Fixture::new();
        let older = f.legacy("AniimoDungeonMap-0.2.2-windows-x64-portable", "older");
        let recent = f.legacy("AniimoDungeonMap-0.2.1-windows-x64-portable", "recent");
        fs::File::options()
            .write(true)
            .open(legacy_storage(&older).unwrap().join("000003.log"))
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1000))
            .unwrap();
        assert_eq!(find_legacy(&f.0.join("fresh")), legacy_storage(&recent));
    }

    #[cfg(windows)]
    #[test]
    fn active_legacy_database_is_not_copied_and_can_be_retried() {
        use std::os::windows::fs::OpenOptionsExt;
        let f = Fixture::new();
        let old = f.legacy("old", "filters");
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(legacy_storage(&old).unwrap().join("LOCK"))
            .unwrap();
        let profile = f.0.join("shared/WebView2");
        assert!(prepare_profile(&profile, &old).is_err());
        assert!(!profile.exists());
        drop(lock);
        prepare_profile(&profile, &old).unwrap();
        assert!(profile.join(STORAGE).join("CURRENT").is_file());
    }
}
