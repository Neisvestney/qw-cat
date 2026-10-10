use crate::ffmpeg_download::remove_stale_downloads;
use crate::ffmpeg_settings::{FfmpegSource, current_ffmpeg_settings};
use crate::ffprobe::BackgroundCommand;
use log::{info, warn};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

pub fn ffmpeg_path() -> PathBuf {
    let settings = current_ffmpeg_settings();
    binary_path("ffmpeg", settings.source, settings.custom_dir.as_deref())
}

pub fn ffprobe_path() -> PathBuf {
    let settings = current_ffmpeg_settings();
    binary_path("ffprobe", settings.source, settings.custom_dir.as_deref())
}

fn executable_name(name: &str) -> PathBuf {
    let mut path = PathBuf::from(name);
    if cfg!(windows) {
        path.set_extension("exe");
    }
    path
}

fn binary_path(name: &str, source: Option<FfmpegSource>, custom_dir: Option<&str>) -> PathBuf {
    let system = PathBuf::from(name);
    let downloaded = sidecar_dir().join(executable_name(name));

    match source {
        Some(FfmpegSource::Downloaded) => downloaded,
        Some(FfmpegSource::System) => system,
        Some(FfmpegSource::Custom) => match custom_dir {
            Some(dir) => Path::new(dir).join(executable_name(name)),
            None => system,
        },
        // Not chosen yet: whatever is there
        None => {
            if downloaded.exists() {
                downloaded
            } else {
                system
            }
        }
    }
}

// Not "ffmpeg": on Linux and macOS the legacy binary sits at exactly that path inside app_local_data_dir
const SIDECAR_DIR_NAME: &str = "bin";

static SIDECAR_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init_sidecar_dir(app_handle: &AppHandle) -> tauri::Result<()> {
    let dir = app_handle.path().app_local_data_dir()?.join(SIDECAR_DIR_NAME);
    migrate_legacy_sidecars(&dir);
    SIDECAR_DIR.set(dir).expect("sidecar dir initialized twice");
    Ok(())
}

pub fn sidecar_dir() -> &'static Path {
    SIDECAR_DIR.get().expect("sidecar dir is not initialized")
}

// Older versions downloaded into the Windows install dir, which the uninstaller never cleans up
#[cfg(windows)]
const LEGACY_APP_DIRECTORY: &str = "Qw Cat";

#[cfg(not(windows))]
const LEGACY_APP_DIRECTORY: &str = "io.github.neisvestney.qw-cat";

fn migrate_legacy_sidecars(dir: &Path) {
    let Some(legacy_dir) = dirs::data_local_dir().map(|d| d.join(LEGACY_APP_DIRECTORY)) else {
        return;
    };
    remove_stale_downloads(&legacy_dir);

    for name in ["ffmpeg", "ffprobe"] {
        let legacy_path = legacy_dir.join(executable_name(name));
        let new_path = dir.join(executable_name(name));
        if !legacy_path.is_file() {
            continue;
        }
        // Already re-downloaded, e.g. after a failed move: the legacy copy is just leftover
        if new_path.exists() {
            if let Err(e) = fs::remove_file(&legacy_path) {
                warn!("Failed to remove {:?}: {e}", legacy_path);
            }
            continue;
        }

        let result = fs::create_dir_all(dir).and_then(|_| fs::rename(&legacy_path, &new_path));
        match result {
            Ok(()) => info!("Moved {:?} to {:?}", legacy_path, new_path),
            Err(e) => warn!("Failed to move {:?} to {:?}: {e}", legacy_path, new_path),
        }
    }
}

fn runs(path: &Path) -> bool {
    Command::new(path)
        .arg("-version")
        .create_no_window()
        .stderr(Stdio::null())
        .stdout(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or_else(|_| false)
}

pub fn source_is_available(source: FfmpegSource, custom_dir: Option<&str>) -> bool {
    runs(&binary_path("ffmpeg", Some(source), custom_dir)) && runs(&binary_path("ffprobe", Some(source), custom_dir))
}

pub fn ffmpeg_is_installed() -> bool {
    runs(&ffmpeg_path())
}

pub fn ffprobe_is_installed() -> bool {
    runs(&ffprobe_path())
}
