use crate::select_new_video_file_command::select_new_video_file_inner;
use log::{error, info};
use std::env;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_dialog::FilePath;

struct OpenedFileState {
    frontend_initialized: bool,
    pending: Option<PathBuf>,
}

static OPENED_FILE: Mutex<OpenedFileState> = Mutex::new(OpenedFileState {
    frontend_initialized: false,
    pending: None,
});

pub async fn handle_cli_args_on_frontend_initialized(app_handle: AppHandle) {
    let args: Vec<String> = env::args().collect();
    info!("Provided cli args: {:?}", args);

    let pending = {
        let mut state = OPENED_FILE.lock().unwrap();
        state.frontend_initialized = true;
        state.pending.take()
    };

    if let Some(file_path) = pending.or_else(|| args.get(1).map(PathBuf::from)) {
        open_video_file(file_path, app_handle).await;
    }
}

// macOS passes files opened from Finder as an Apple Event instead of argv, possibly before the frontend is ready
#[cfg(target_os = "macos")]
pub fn handle_opened_urls(app_handle: &AppHandle, urls: Vec<tauri::Url>) {
    let Some(file_path) = urls.into_iter().find_map(|url| url.to_file_path().ok()) else {
        return;
    };
    info!("Opened file: {:?}", file_path);

    let mut state = OPENED_FILE.lock().unwrap();
    if state.frontend_initialized {
        drop(state);
        tauri::async_runtime::spawn(open_video_file(file_path, app_handle.clone()));
    } else {
        state.pending = Some(file_path);
    }
}

async fn open_video_file(file_path: PathBuf, app_handle: AppHandle) {
    let result = select_new_video_file_inner(Some(FilePath::Path(file_path)), app_handle).await;
    if let Err(e) = result {
        error!("Failed to select video file: {}", e);
    }
}
