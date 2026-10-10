use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{Duration, SystemTime},
};

use crate::APP_IDENTIFIER;
use log::warn;
use tauri::{AppHandle, Manager};
use tokio::fs;
use tokio::io;

const MEDIA_CACHE_DIR_NAME: &str = "media";

static MEDIA_CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

// Kept in its own subdir so the integrated server, which serves anything inside it, can't reach thumbnails
pub fn init_media_cache_dir(app_handle: &AppHandle) -> tauri::Result<()> {
    let dir = app_handle.path().app_cache_dir()?.join(MEDIA_CACHE_DIR_NAME);
    MEDIA_CACHE_DIR.set(dir).expect("media cache dir initialized twice");
    Ok(())
}

pub fn media_cache_dir() -> &'static Path {
    MEDIA_CACHE_DIR.get().expect("media cache dir is not initialized")
}

pub async fn cleanup_temp() -> io::Result<()> {
    remove_legacy_temp_dir().await;

    let dir = media_cache_dir();

    // If the directory doesn't exist, nothing to do
    if !dir.exists() {
        return Ok(());
    }

    let cutoff = SystemTime::now().checked_sub(Duration::from_secs(60 * 60)).expect("time went backwards");

    let mut entries = fs::read_dir(dir).await?;

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();

        // Skip directories; only delete files
        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };

        if metadata.is_file()
            && let Ok(modified) = metadata.modified()
            && modified < cutoff
        {
            // Ignore individual file errors to avoid stopping cleanup
            let _ = fs::remove_file(path).await;
        }
    }

    Ok(())
}

// Older versions cached media in the shared temp dir
async fn remove_legacy_temp_dir() {
    let legacy_dir = std::env::temp_dir().join(APP_IDENTIFIER);
    if legacy_dir.exists()
        && let Err(e) = fs::remove_dir_all(&legacy_dir).await
    {
        warn!("Failed to remove legacy temp dir {}: {e}", legacy_dir.display());
    }
}
