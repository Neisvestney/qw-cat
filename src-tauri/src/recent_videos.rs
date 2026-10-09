use crate::ffmpeg_path::{ffmpeg_is_installed, ffmpeg_path};
use crate::ffprobe::BackgroundCommand;
use crate::select_new_video_file_command::select_new_video_file_inner;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use log::{error, warn};
use serde::{Deserialize, Serialize};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, async_runtime};
use tauri_plugin_dialog::FilePath;

const RECENT_VIDEOS_FILE: &str = "recent_videos.json";
const THUMBNAILS_DIR: &str = "thumbnails";
const MAX_RECENT_VIDEOS: usize = 10;

// Serializes read-modify-write of the recent videos file
static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RecentVideoEntry {
    path: String,
    opened_at: u64,
    thumbnail: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct RecentVideo {
    pub path: String,
    pub opened_at: u64,
    // Data URL of a jpeg frame
    pub thumbnail: Option<String>,
}

fn recent_videos_path(app_handle: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app_handle.path().app_config_dir()?.join(RECENT_VIDEOS_FILE))
}

fn thumbnails_dir(app_handle: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app_handle.path().app_cache_dir()?.join(THUMBNAILS_DIR))
}

fn load(app_handle: &AppHandle) -> anyhow::Result<Vec<RecentVideoEntry>> {
    let path = recent_videos_path(app_handle)?;
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };

    Ok(serde_json::from_str(&content).unwrap_or_else(|e| {
        warn!("Recent videos in {path:?} are malformed: {e}");
        vec![]
    }))
}

fn save(app_handle: &AppHandle, entries: &[RecentVideoEntry]) -> anyhow::Result<()> {
    let path = recent_videos_path(app_handle)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }

    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, serde_json::to_vec_pretty(entries)?)?;
    std::fs::rename(&tmp_path, &path)?;
    Ok(())
}

fn remove_thumbnail(app_handle: &AppHandle, entry: &RecentVideoEntry) {
    if let (Some(name), Ok(dir)) = (&entry.thumbnail, thumbnails_dir(app_handle)) {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

fn thumbnail_name(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}.jpg", hasher.finish())
}

fn generate_thumbnail(video_path: &str, out_path: &Path, duration: f64) -> anyhow::Result<()> {
    if !ffmpeg_is_installed() {
        anyhow::bail!("ffmpeg is not installed");
    }
    if let Some(dir) = out_path.parent() {
        std::fs::create_dir_all(dir)?;
    }

    // A frame a bit into the video, the first one is often black
    let seek = (duration * 0.1).clamp(0.0, 10.0);

    #[rustfmt::skip]
    let status = Command::new(ffmpeg_path())
        .create_no_window()
        .args([
            "-y",
            "-ss", &format!("{seek:.3}"),
            "-i", video_path,
            "-frames:v", "1",
            "-vf", "scale=320:-2",
            "-q:v", "5",
        ])
        .arg(out_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;

    if !status.success() || !out_path.exists() {
        anyhow::bail!("ffmpeg exited with {status}");
    }
    Ok(())
}

pub fn record_recent_video(app_handle: AppHandle, path: String, duration: f64) {
    async_runtime::spawn_blocking(move || {
        if let Err(e) = record_recent_video_inner(&app_handle, path, duration) {
            error!("Can't record recent video: {e:?}");
        }
    });
}

fn record_recent_video_inner(app_handle: &AppHandle, path: String, duration: f64) -> anyhow::Result<()> {
    let name = thumbnail_name(&path);
    let thumbnail_path = thumbnails_dir(app_handle)?.join(&name);
    let cached = thumbnail_path.exists();
    let opened_at = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;

    // Inserted before the slow thumbnail generation, so a removal made meanwhile isn't undone
    {
        let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries = load(app_handle)?;
        entries.retain(|e| e.path != path);
        entries.insert(
            0,
            RecentVideoEntry {
                path: path.clone(),
                opened_at,
                thumbnail: cached.then(|| name.clone()),
            },
        );
        for dropped in entries.split_off(MAX_RECENT_VIDEOS.min(entries.len())) {
            remove_thumbnail(app_handle, &dropped);
        }
        save(app_handle, &entries)?;
    }

    if cached {
        return Ok(());
    }
    if let Err(e) = generate_thumbnail(&path, &thumbnail_path, duration) {
        warn!("Can't generate thumbnail for {path}: {e:?}");
        return Ok(());
    }

    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut entries = load(app_handle)?;
    match entries.iter_mut().find(|e| e.path == path) {
        Some(entry) => {
            entry.thumbnail = Some(name);
            save(app_handle, &entries)
        }
        None => {
            let _ = std::fs::remove_file(&thumbnail_path);
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn get_recent_videos(app_handle: AppHandle) -> Vec<RecentVideo> {
    async_runtime::spawn_blocking(move || get_recent_videos_inner(&app_handle))
        .await
        .unwrap_or_else(|e| {
            error!("Can't load recent videos: {e:?}");
            vec![]
        })
}

fn get_recent_videos_inner(app_handle: &AppHandle) -> Vec<RecentVideo> {
    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let entries = match load(app_handle) {
        Ok(entries) => entries,
        Err(e) => {
            error!("Can't read recent videos: {e:?}");
            return vec![];
        }
    };

    let (existing, missing): (Vec<_>, Vec<_>) = entries.into_iter().partition(|e| Path::new(&e.path).is_file());
    if !missing.is_empty() {
        missing.iter().for_each(|e| remove_thumbnail(app_handle, e));
        if let Err(e) = save(app_handle, &existing) {
            error!("Can't save recent videos: {e:?}");
        }
    }

    let thumbnails_dir = thumbnails_dir(app_handle).ok();
    existing
        .into_iter()
        .map(|e| {
            let thumbnail = e
                .thumbnail
                .zip(thumbnails_dir.as_ref())
                .and_then(|(name, dir)| std::fs::read(dir.join(name)).ok())
                .map(|bytes| format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
            RecentVideo {
                path: e.path,
                opened_at: e.opened_at,
                thumbnail,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn remove_recent_video(app_handle: AppHandle, path: String) -> Result<(), String> {
    async_runtime::spawn_blocking(move || remove_recent_video_inner(&app_handle, &path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            error!("Can't remove recent video: {e:?}");
            e.to_string()
        })
}

fn remove_recent_video_inner(app_handle: &AppHandle, path: &str) -> anyhow::Result<()> {
    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (removed, kept): (Vec<_>, Vec<_>) = load(app_handle)?.into_iter().partition(|e| e.path == path);
    if removed.is_empty() {
        return Ok(());
    }
    removed.iter().for_each(|e| remove_thumbnail(app_handle, e));
    save(app_handle, &kept)
}

// Only paths from the list are accepted, so the webview can't open arbitrary files through it
#[tauri::command]
pub async fn open_recent_video(app_handle: AppHandle, path: String) -> Result<(), String> {
    let known = {
        let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        load(&app_handle).map_err(|e| e.to_string())?.iter().any(|e| e.path == path)
    };
    if !known {
        return Err("Video is not in the recent list".into());
    }
    if !Path::new(&path).is_file() {
        return Err("Video file no longer exists".into());
    }

    select_new_video_file_inner(Some(FilePath::Path(path.into())), app_handle)
        .await
        .map_err(|e| {
            error!("Can't open recent video: {e:?}");
            e.to_string()
        })
}
