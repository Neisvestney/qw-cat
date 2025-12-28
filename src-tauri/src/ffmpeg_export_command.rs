use crate::ffmpeg::{FfmpegTasksQueue, cancel_ffmpeg_task, enqueue_export_video_task};
use log::info;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize, Debug, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub start_time: f64,
    pub end_time: f64,
    pub input_path: String,
    pub output_path: String,
    pub resolution: Option<String>,
    pub bitrate: Option<String>,
    pub video_codec: Option<String>,
    pub frame_rate: Option<f64>,
    pub active_audio_streams: Vec<ExportAudioStreamOptions>,
    pub gpu_acceleration: Option<GpuAcceleration>,
}

#[derive(Serialize, Deserialize, Debug, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ExportAudioStreamOptions {
    pub index: usize,
    pub gain: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum GpuAcceleration {
    Nvidia,
}

#[tauri::command]
pub async fn ffmpeg_export(app_handle: tauri::AppHandle, options: ExportOptions) {
    println!("ffmpeg_export called, {:?}", options);

    let ffmpeg_tasks_queue = app_handle.state::<FfmpegTasksQueue>();

    enqueue_export_video_task(&ffmpeg_tasks_queue, options).await;
}

#[tauri::command]
pub async fn cancel_ffmpeg_task_by_index(app_handle: tauri::AppHandle, task_index: usize) {
    let ffmpeg_tasks_queue = app_handle.state::<FfmpegTasksQueue>();
    let ffmpeg_tasks_queue = ffmpeg_tasks_queue.lock().await;
    let task = ffmpeg_tasks_queue.get(task_index);
    info!("task to cancel: {:?}", task);
    if let Some(task) = task {
        cancel_ffmpeg_task(task).await;
    }
}
