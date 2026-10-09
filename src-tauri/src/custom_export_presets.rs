use log::{error, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const PRESETS_FILE: &str = "export_presets.json";

#[derive(Serialize, Deserialize, Debug, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct CustomExportPreset {
    pub id: String,
    pub title: String,
    pub family: String,
    pub container: String,
    pub short_side: Option<f64>,
    pub frame_rate: Option<f64>,
    pub bitrate_kbps: Option<f64>,
    pub target_size_mb: Option<f64>,
    // GPU when available, CPU otherwise
    pub use_gpu: bool,
    pub audio_codec: String,
    pub audio_bitrate_kbps: f64,
    pub mix_audio: bool,
}

fn presets_path(app_handle: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app_handle.path().app_config_dir()?.join(PRESETS_FILE))
}

#[tauri::command]
pub async fn get_custom_export_presets(app_handle: AppHandle) -> Vec<CustomExportPreset> {
    let path = match presets_path(&app_handle) {
        Ok(path) => path,
        Err(e) => {
            error!("Can't resolve the export presets path: {e}");
            return vec![];
        }
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return vec![],
        Err(e) => {
            error!("Can't read export presets from {path:?}: {e}");
            return vec![];
        }
    };

    serde_json::from_str(&content).unwrap_or_else(|e| {
        warn!("Export presets in {path:?} are malformed: {e}");
        vec![]
    })
}

// Sync on purpose: sync commands run one by one on the main thread in call order,
// so an older list can't overwrite a newer one
#[tauri::command]
pub fn save_custom_export_presets(app_handle: AppHandle, presets: Vec<CustomExportPreset>) -> Result<(), String> {
    save(&app_handle, &presets).map_err(|e| {
        error!("Can't save export presets: {e:?}");
        e.to_string()
    })
}

fn save(app_handle: &AppHandle, presets: &[CustomExportPreset]) -> anyhow::Result<()> {
    let path = presets_path(app_handle)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }

    // Written aside and renamed, so a crash mid-write can't wipe the existing presets
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, serde_json::to_vec_pretty(presets)?)?;
    std::fs::rename(&tmp_path, &path)?;
    Ok(())
}
