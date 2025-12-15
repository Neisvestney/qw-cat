use crate::ffmpeg::{FfmpegTasksQueue, enqueue_extract_audio_task};
use crate::ffprobe;
use crate::ffprobe::VideoAudioStreamsInfo;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::ipc::Channel;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;
use ts_rs::TS;

#[derive(Deserialize, Serialize, TS)]
pub struct SelectedVideoFile {
    path: String,
    audio_steams: VideoAudioStreamsInfo,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
pub struct AudioStreamFilePath {
    pub index: i32,
    pub path: String,
}

#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "event")]
#[ts(export)]
pub enum SelectNewVideoFileEvent {
    VideoFilePicked,
    VideoFileInfoReady { video_file: Option<SelectedVideoFile> },
    VideoAudioSteamsReady { audio_streams: Vec<AudioStreamFilePath> },
}

#[tauri::command]
pub async fn select_new_video_file(app_handle: tauri::AppHandle, on_event: Channel<SelectNewVideoFileEvent>) {
    let file_path = pick_file_async(&app_handle).await;
    on_event.send(SelectNewVideoFileEvent::VideoFilePicked).unwrap();

    if let Some(path) = file_path {
        app_handle.asset_protocol_scope().allow_file(path.as_path().unwrap()).unwrap();

        let path = path.to_string();
        let audio_steams = ffprobe::get_video_audio_streams_info(&path).unwrap_or(VideoAudioStreamsInfo::empty());
        let selected_video_file = Some(SelectedVideoFile {
            path: path.clone(),
            audio_steams,
        });

        let ffmpeg_tasks_queue = app_handle.state::<FfmpegTasksQueue>();
        let (tx, rx) = oneshot::channel();
        enqueue_extract_audio_task(ffmpeg_tasks_queue.inner(), path, Some(tx)).await;

        on_event
            .send(SelectNewVideoFileEvent::VideoFileInfoReady {
                video_file: selected_video_file,
            })
            .unwrap();

        if let Ok(result) = rx.await {
            on_event
                .send(SelectNewVideoFileEvent::VideoAudioSteamsReady {
                    audio_streams: result.audio_streams,
                })
                .unwrap();
        }
    } else {
        on_event.send(SelectNewVideoFileEvent::VideoFileInfoReady { video_file: None }).unwrap();
    }
}

async fn pick_file_async(app_handle: &tauri::AppHandle) -> Option<FilePath> {
    let (tx, rx) = oneshot::channel();

    app_handle.dialog().file().pick_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    rx.await.unwrap()
}
