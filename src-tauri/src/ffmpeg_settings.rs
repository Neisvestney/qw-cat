use crate::ffmpeg::{FfmpegTasksQueue, enqueue_download_ffmpeg_task};
use crate::ffmpeg_path::source_is_available;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::{AppHandle, Manager};
use tokio::sync::OnceCell;

const SETTINGS_FILE: &str = "ffmpeg_settings.json";

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum FfmpegSource {
    Downloaded,
    System,
    Custom,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegSettings {
    // None until the user picks one on first run
    pub source: Option<FfmpegSource>,
    // Kept when switching away from Custom, so the folder is still filled in on return
    pub custom_dir: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegSettingsState {
    pub settings: FfmpegSettings,
    pub system_available: bool,
    pub downloaded_available: bool,
}

static SETTINGS: RwLock<FfmpegSettings> = RwLock::new(FfmpegSettings {
    source: None,
    custom_dir: None,
});

static STARTUP_SOURCE: OnceCell<()> = OnceCell::const_new();

pub fn current_ffmpeg_settings() -> FfmpegSettings {
    SETTINGS.read().unwrap_or_else(|e| e.into_inner()).clone()
}

fn settings_path(app_handle: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app_handle.path().app_config_dir()?.join(SETTINGS_FILE))
}

pub fn load_ffmpeg_settings(app_handle: &AppHandle) {
    let path = match settings_path(app_handle) {
        Ok(path) => path,
        Err(e) => {
            error!("Can't resolve the ffmpeg settings path: {e}");
            return;
        }
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(e) => {
            error!("Can't read ffmpeg settings from {path:?}: {e}");
            return;
        }
    };

    match serde_json::from_str(&content) {
        Ok(settings) => *SETTINGS.write().unwrap_or_else(|e| e.into_inner()) = settings,
        Err(e) => warn!("FFmpeg settings in {path:?} are malformed: {e}"),
    }
}

// Applied in memory only once written, so a failed save doesn't leave the app and the UI disagreeing
fn store(app_handle: &AppHandle, settings: FfmpegSettings) -> anyhow::Result<()> {
    let path = settings_path(app_handle)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, serde_json::to_vec_pretty(&settings)?)?;
    std::fs::rename(&tmp_path, &path)?;

    *SETTINGS.write().unwrap_or_else(|e| e.into_inner()) = settings;
    Ok(())
}

async fn check_availability() -> (bool, bool) {
    tokio::task::spawn_blocking(|| {
        (
            source_is_available(FfmpegSource::System, None),
            source_is_available(FfmpegSource::Downloaded, None),
        )
    })
    .await
    .unwrap_or_default()
}

/// Picks the source silently unless there is a real choice to make, then downloads ffmpeg if needed.
pub async fn init_ffmpeg_source(app_handle: &AppHandle) {
    STARTUP_SOURCE
        .get_or_init(|| async {
            if current_ffmpeg_settings().source.is_none() {
                let (system_available, downloaded_available) = check_availability().await;
                info!("FFmpeg source not chosen yet (system: {system_available}, downloaded: {downloaded_available})");

                // Existing downloads keep being used; without a system ffmpeg there is nothing to ask
                if downloaded_available || !system_available {
                    let settings = FfmpegSettings {
                        source: Some(FfmpegSource::Downloaded),
                        custom_dir: None,
                    };
                    if let Err(e) = store(app_handle, settings.clone()) {
                        error!("Can't save ffmpeg settings: {e:?}");
                        // Nobody to show the error to, so at least this session gets ffmpeg
                        *SETTINGS.write().unwrap_or_else(|e| e.into_inner()) = settings;
                    }
                }
            }

            if current_ffmpeg_settings().source == Some(FfmpegSource::Downloaded) {
                enqueue_download_ffmpeg_task(&app_handle.state::<FfmpegTasksQueue>()).await;
            }
        })
        .await;
}

#[tauri::command]
pub async fn get_ffmpeg_settings(app_handle: AppHandle) -> FfmpegSettingsState {
    init_ffmpeg_source(&app_handle).await;
    let (system_available, downloaded_available) = check_availability().await;

    FfmpegSettingsState {
        settings: current_ffmpeg_settings(),
        system_available,
        downloaded_available,
    }
}

#[tauri::command]
pub async fn set_ffmpeg_settings(app_handle: AppHandle, settings: FfmpegSettings) -> Result<(), String> {
    let source = settings.source.ok_or("FFmpeg source is not selected")?;

    if source != FfmpegSource::Downloaded {
        let custom_dir = settings.custom_dir.clone();
        let available = tokio::task::spawn_blocking(move || source_is_available(source, custom_dir.as_deref()))
            .await
            .unwrap_or(false);
        if !available {
            return Err(match source {
                FfmpegSource::Custom => "ffmpeg and ffprobe were not found in the selected folder".into(),
                _ => "ffmpeg and ffprobe were not found in PATH".into(),
            });
        }
    }

    info!("FFmpeg settings changed: {settings:?}");
    store(&app_handle, settings).map_err(|e| {
        error!("Can't save ffmpeg settings: {e:?}");
        e.to_string()
    })?;

    if source == FfmpegSource::Downloaded {
        enqueue_download_ffmpeg_task(&app_handle.state::<FfmpegTasksQueue>()).await;
    }
    Ok(())
}
