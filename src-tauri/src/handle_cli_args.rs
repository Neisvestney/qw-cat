use crate::select_new_video_file_command::select_new_video_file_inner;
use log::{error, info};
use std::env;
use tauri::AppHandle;
use tauri_plugin_dialog::FilePath;

pub async fn handle_cli_args_on_frontend_initialized(app_handle: AppHandle) {
    let args: Vec<String> = env::args().collect();
    info!("Provided cli args: {:?}", args);
    if let Some(file_path) = args.get(1) {
        let file_path = FilePath::Path(file_path.into());
        let result = select_new_video_file_inner(Some(file_path), app_handle).await;
        if let Err(e) = result {
            error!("Failed to select video file from cli args: {}", e);
        }
    }
}
