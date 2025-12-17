mod ffmpeg;
mod ffprobe;
mod select_new_video_file_command;
mod ffmpeg_time_duration;
mod ffmpeg_export_command;
mod handle_main_window_event;

use crate::ffmpeg::create_ffmpeg_tasks_queue;
use crate::select_new_video_file_command::select_new_video_file;
use std::sync::OnceLock;
use tauri::{AppHandle, generate_handler, Manager};
use crate::ffmpeg_export_command::ffmpeg_export;
use crate::handle_main_window_event::handle_main_window_event;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            APP_HANDLE.set(app.handle().clone()).unwrap();

            let main_window = app.get_webview_window("main").unwrap();
            main_window.on_window_event(handle_main_window_event);

            Ok(())
        })
        .manage(create_ffmpeg_tasks_queue())
        .invoke_handler(generate_handler![select_new_video_file, ffmpeg_export])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
