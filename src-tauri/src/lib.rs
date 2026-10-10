mod custom_export_presets;
mod ffmpeg;
mod ffmpeg_download;
mod ffmpeg_export_command;
mod ffmpeg_path;
mod ffmpeg_settings;
mod ffmpeg_time_duration;
mod ffprobe;
mod handle_cli_args;
mod handle_main_window_event;
mod hw_encoders;
mod integrated_server;
mod logs_store;
mod open_devtools_command;
mod playback_copy_command;
mod recent_videos;
mod select_new_video_file_command;
mod temp_cleanup;

use crate::custom_export_presets::{get_custom_export_presets, save_custom_export_presets};
use crate::ffmpeg::{create_ffmpeg_tasks_queue, emit_ffmpeg_queue_status};
use crate::ffmpeg_export_command::{cancel_ffmpeg_task_by_index, ffmpeg_export};
use crate::ffmpeg_path::init_sidecar_dir;
use crate::ffmpeg_settings::{get_ffmpeg_settings, init_ffmpeg_source, load_ffmpeg_settings, set_ffmpeg_settings};
use crate::handle_cli_args::handle_cli_args_on_frontend_initialized;
#[cfg(target_os = "macos")]
use crate::handle_cli_args::handle_opened_urls;
use crate::handle_main_window_event::handle_main_window_event;
use crate::hw_encoders::{detect_hw_encoders, get_gpu_vendors};
use crate::integrated_server::{IntegratedServerState, get_integrated_server_state, start_integrated_server};
use crate::logs_store::{LogsStore, get_logs, get_logs_store_target};
use crate::open_devtools_command::open_devtools;
use crate::playback_copy_command::prepare_playback_copy;
use crate::recent_videos::{get_recent_videos, open_recent_video, remove_recent_video};
use crate::select_new_video_file_command::select_new_video_file;
use crate::temp_cleanup::{cleanup_temp, init_media_cache_dir};
use std::env;
use std::ops::Deref;
use std::sync::OnceLock;
use tauri::{AppHandle, Listener, Manager, async_runtime, generate_handler};
use tauri_plugin_log::fern::colors::ColoredLevelConfig;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub const APP_IDENTIFIER: &str = "io.github.neisvestney.qw-cat";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Debug)
                .with_colors(ColoredLevelConfig::new())
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview))
                .target(tauri_plugin_log::Target::new(get_logs_store_target()))
                .build(),
        )
        .plugin(prevent_default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            APP_HANDLE.set(app.handle().clone()).unwrap();
            init_media_cache_dir(app.handle())?;
            init_sidecar_dir(app.handle())?;

            let main_window = app.get_webview_window("main").unwrap();
            main_window.on_window_event(handle_main_window_event);

            async_runtime::spawn(cleanup_temp());

            load_ffmpeg_settings(app.handle());
            let app_handle = app.handle().clone();
            async_runtime::spawn(async move { init_ffmpeg_source(&app_handle).await });

            let app_handle = app.handle().clone();
            app.listen("frontend-initialized", move |_event| {
                let app_handle = app_handle.clone();
                async_runtime::spawn(emit_ffmpeg_queue_status());
                async_runtime::spawn(handle_cli_args_on_frontend_initialized(app_handle));
            });

            let files_host_server_state = app.state::<IntegratedServerState>().deref().clone();
            let app_handle = app.handle().clone();
            async_runtime::spawn(start_integrated_server(app_handle, files_host_server_state));

            Ok(())
        })
        .manage(create_ffmpeg_tasks_queue())
        .manage(IntegratedServerState::new())
        .manage(LogsStore::new())
        .invoke_handler(generate_handler![
            select_new_video_file,
            ffmpeg_export,
            get_integrated_server_state,
            get_logs,
            open_devtools,
            cancel_ffmpeg_task_by_index,
            detect_hw_encoders,
            get_gpu_vendors,
            get_custom_export_presets,
            save_custom_export_presets,
            get_recent_videos,
            open_recent_video,
            remove_recent_video,
            prepare_playback_copy,
            get_ffmpeg_settings,
            set_ffmpeg_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                handle_opened_urls(_app_handle, urls);
            }
        });
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
