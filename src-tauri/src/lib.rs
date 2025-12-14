mod ffprobe;
mod select_new_video_file_command;
mod ffmpeg;

use std::sync::OnceLock;
use tauri::{generate_handler, AppHandle};
use crate::ffmpeg::create_ffmpeg_tasks_queue;
use crate::select_new_video_file_command::select_new_video_file;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            APP_HANDLE.set(app.handle().clone()).unwrap();
            Ok(())
        })
        .manage(create_ffmpeg_tasks_queue())
        .invoke_handler(generate_handler![select_new_video_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
