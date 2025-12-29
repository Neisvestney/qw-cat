use std::{
    path::PathBuf,
    time::{Duration, SystemTime},
};

use tokio::fs;
use tokio::io;
use crate::APP_IDENTIFIER;

pub async fn cleanup_temp() -> io::Result<()> {
    let mut dir: PathBuf = std::env::temp_dir();
    dir.push(APP_IDENTIFIER);

    // If the directory doesn't exist, nothing to do
    if !dir.exists() {
        return Ok(());
    }

    let cutoff = SystemTime::now().checked_sub(Duration::from_secs(60 * 60)).expect("time went backwards");

    let mut entries = fs::read_dir(&dir).await?;

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
