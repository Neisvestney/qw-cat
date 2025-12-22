mod ffmpeg;
mod ffmpeg_export_command;
mod ffmpeg_time_duration;
mod ffprobe;
mod handle_main_window_event;
mod select_new_video_file_command;
mod temp_cleanup;
mod ffmpeg_download;

use crate::ffmpeg::{create_ffmpeg_tasks_queue, emit_ffmpeg_queue_status, enqueue_download_ffmpeg_task, FfmpegTasksQueue};
use crate::ffmpeg_export_command::ffmpeg_export;
use crate::handle_main_window_event::handle_main_window_event;
use crate::select_new_video_file_command::select_new_video_file;
use crate::temp_cleanup::cleanup_temp;
use std::sync::OnceLock;
use log::info;
use tauri::{async_runtime, generate_handler, AppHandle, Listener, Manager};
use tauri_plugin_log::fern::colors::ColoredLevelConfig;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Debug)
                .with_colors(ColoredLevelConfig::new())
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview))
                .build(),
        )
        .plugin(prevent_default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            APP_HANDLE.set(app.handle().clone()).unwrap();

            let main_window = app.get_webview_window("main").unwrap();
            main_window.on_window_event(handle_main_window_event);

            async_runtime::spawn(cleanup_temp());

            let app_handle = app.handle().clone();
            async_runtime::spawn(async move {
                let queue = app_handle.state::<FfmpegTasksQueue>();
                enqueue_download_ffmpeg_task(&queue).await;
            });

            app.listen("frontend-initialized", |_event| {
                async_runtime::spawn(emit_ffmpeg_queue_status());
            });

            Ok(())
        })
        .manage(create_ffmpeg_tasks_queue())
        .invoke_handler(generate_handler![select_new_video_file, ffmpeg_export])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(debug_assertions)]
fn prevent_default() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;

    tauri_plugin_prevent_default::Builder::new()
        .with_flags(Flags::all().difference(Flags::DEV_TOOLS | Flags::RELOAD))
        .build()
}

#[cfg(not(debug_assertions))]
fn prevent_default() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_prevent_default::init()
}
