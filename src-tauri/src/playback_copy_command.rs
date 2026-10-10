use crate::ffmpeg::{FfmpegTasksQueue, enqueue_remux_video_task};
use log::error;
use tauri::Manager;
use tokio::sync::oneshot;

// Returns the path of an mp4 copy for sources whose container the webview can't play, None if remuxing failed
#[tauri::command]
pub async fn prepare_playback_copy(app_handle: tauri::AppHandle, video_file_path: String) -> Option<String> {
    if !app_handle.asset_protocol_scope().is_allowed(&video_file_path) {
        error!("Playback copy requested for a file that was not opened: {video_file_path}");
        return None;
    }

    let ffmpeg_tasks_queue = app_handle.state::<FfmpegTasksQueue>();
    let (tx, rx) = oneshot::channel();
    enqueue_remux_video_task(ffmpeg_tasks_queue.inner(), video_file_path, Some(tx)).await;

    rx.await.ok().map(|result| result.output_path)
}
