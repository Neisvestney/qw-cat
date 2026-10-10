use std::path::Path;
use tauri::async_runtime;

#[tauri::command]
pub async fn path_exists(path: String) -> bool {
    async_runtime::spawn_blocking(move || Path::new(&path).exists()).await.unwrap_or(false)
}
