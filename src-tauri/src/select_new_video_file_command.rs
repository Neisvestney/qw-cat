use crate::ffmpeg::{FfmpegTasksQueue, enqueue_extract_audio_task};
use crate::ffprobe;
use crate::ffprobe::VideoAudioStreamsInfo;
use crate::integrated_server::IntegratedServerState;
use log::error;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;
use ts_rs::TS;

#[derive(Clone, Deserialize, Serialize, TS)]
pub struct SelectedVideoFile {
    path: String,
    audio_steams: VideoAudioStreamsInfo,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
pub struct AudioStreamFilePath {
    pub index: i32,
    pub path: String,
}

#[allow(clippy::enum_variant_names)]
#[derive(Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "event")]
#[ts(export)]
pub enum SelectNewVideoFileEvent {
    VideoFilePicked,
    VideoFileInfoReady {
        video_file: Option<SelectedVideoFile>,
    },
    VideoAudioSteamsReady {
        video_file: String,
        audio_streams: Vec<AudioStreamFilePath>,
    },
}

#[tauri::command]
pub async fn select_new_video_file(app_handle: tauri::AppHandle) {
    let file_path = pick_file_async(&app_handle).await;
    if let Err(e) = select_new_video_file_inner(file_path, app_handle).await {
        error!("Error while selecting new video file: {:?}", e);
    }
}

pub async fn select_new_video_file_inner(file_path: Option<FilePath>, app_handle: tauri::AppHandle) -> tauri::Result<()> {
    send_select_new_video_file_event(&app_handle, SelectNewVideoFileEvent::VideoFilePicked)?;

    if let Some(path) = file_path {
        app_handle.asset_protocol_scope().allow_file(path.as_path().unwrap())?;
        app_handle.state::<IntegratedServerState>().allow_file(path.to_string()).await;

        let path = path.to_string();
        let audio_steams = ffprobe::get_video_audio_streams_info(&path).unwrap_or(VideoAudioStreamsInfo::empty());
        let selected_video_file = Some(SelectedVideoFile {
            path: path.clone(),
            audio_steams,
        });

        let ffmpeg_tasks_queue = app_handle.state::<FfmpegTasksQueue>();
        let (tx, rx) = oneshot::channel();
        enqueue_extract_audio_task(ffmpeg_tasks_queue.inner(), path.clone(), Some(tx)).await;

        send_select_new_video_file_event(
            &app_handle,
            SelectNewVideoFileEvent::VideoFileInfoReady {
                video_file: selected_video_file,
            },
        )?;

        if let Ok(result) = rx.await {
            send_select_new_video_file_event(
                &app_handle,
                SelectNewVideoFileEvent::VideoAudioSteamsReady {
                    audio_streams: result.audio_streams,
                    video_file: path,
                },
            )?;
        }
    } else {
        send_select_new_video_file_event(&app_handle, SelectNewVideoFileEvent::VideoFileInfoReady { video_file: None })?;
    }

    Ok(())
}

fn send_select_new_video_file_event(app_handle: &tauri::AppHandle, event: SelectNewVideoFileEvent) -> tauri::Result<()> {
    app_handle.emit("select-new-video-file-event", event)
}

async fn pick_file_async(app_handle: &tauri::AppHandle) -> Option<FilePath> {
    let (tx, rx) = oneshot::channel();

    app_handle.dialog().file().pick_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    rx.await.unwrap()
}
