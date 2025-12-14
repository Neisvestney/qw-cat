use crate::ffprobe::{get_video_audio_streams_info, pase_duration};
use crate::select_new_video_file_command::AudioStreamFilePath;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use ffmpeg_sidecar::command::FfmpegCommand;
use ffmpeg_sidecar::event::{FfmpegEvent, LogLevel};
use std::sync::{Arc};
use futures::FutureExt;
use futures::sink::SinkMapErr;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{oneshot, Mutex, RwLock, MutexGuard};
use crate::APP_HANDLE;

#[derive(Debug, Serialize, Deserialize, ts_rs::TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FfmpegTask {
    status: FfmpegTaskStatus,
    task_type: FfmpegTaskType,
}

impl FfmpegTask {
    pub fn new(task_type: FfmpegTaskType) -> Self {
        Self {
            status: FfmpegTaskStatus::Queued,
            task_type,
        }
    }
}

#[derive(PartialEq, Clone, Copy, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum FfmpegTaskStatus {
    Queued,
    InProgress {
        progress: f64
    },
    Finished,
}

#[derive(Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum FfmpegTaskType {
    ExtractAudio {
        video_file_path: String,
        result: Option<FfmpegAudioExtractTaskResult>,
        #[serde(skip)]
        on_complete: Option<oneshot::Sender<FfmpegAudioExtractTaskResult>>,
    },
    ExportVideo {

    }
}

impl Clone for FfmpegTaskType {
    fn clone(&self) -> Self {
        match self {
            FfmpegTaskType::ExtractAudio { video_file_path, result, .. } => {
                FfmpegTaskType::ExtractAudio {
                    video_file_path: video_file_path.clone(),
                    result: result.clone(),
                    on_complete: None,
                }
            },
            FfmpegTaskType::ExportVideo {  } => FfmpegTaskType::ExportVideo {}
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
pub struct FfmpegAudioExtractTaskResult {
    pub audio_streams: Vec<AudioStreamFilePath>,
}

impl FfmpegTaskType {
    pub fn extract_audio(
        path: String,
        on_complete: Option<oneshot::Sender<FfmpegAudioExtractTaskResult>>,
    ) -> Self {
        Self::ExtractAudio {
            video_file_path: path,
            result: None,
            on_complete,
        }
    }
}

pub type FfmpegTasksQueue = Mutex<Vec<Arc<RwLock<FfmpegTask>>>>;

pub fn create_ffmpeg_tasks_queue() -> FfmpegTasksQueue {
    Mutex::new(Vec::new())
}

pub async fn enqueue_ffmpeg_task(queue: &FfmpegTasksQueue, task: FfmpegTask) {
    let mut queue = queue.lock().await;
    queue.push(Arc::new(RwLock::new(task)));
    run_next_task(queue).await;
}

pub async fn run_next_task(queue: MutexGuard<'_, Vec<Arc<RwLock<FfmpegTask>>>>) {
    let mut has_in_progress = false;
    let mut first_queued_task = None;

    for task in queue.iter() {
        if matches!(task.read().await.status, FfmpegTaskStatus::InProgress {..}) {
            has_in_progress = true;
            break;
        }

        if first_queued_task.is_none() && matches!(task.read().await.status, FfmpegTaskStatus::Queued) {
            first_queued_task = Some(task.clone());
        }
    }

    drop(queue);

    if !has_in_progress && let Some(next_task) = first_queued_task {
        tokio::spawn(run_ffmpeg_task(next_task));
    }
}

fn get_audio_file_path(video_file_path: &str, audio_stream_index: i32, format: &str) -> String {
    let tmp_folder = std::env::temp_dir().join("qw-cat");
    std::fs::create_dir_all(&tmp_folder).unwrap();
    let audio_file_name = format!(
        "audio_{}_{}.{}",
        BASE64_STANDARD.encode(video_file_path),
        audio_stream_index,
        format
    );

    tmp_folder
        .join(audio_file_name)
        .to_string_lossy()
        .to_string()
}

fn run_ffmpeg_task(ffmpeg_task: Arc<RwLock<FfmpegTask>>) -> impl Future<Output = ()> + Send {
    async move {
        emit_ffmpeg_queue_status().await;

        let ffmpeg_task_guard = ffmpeg_task.read().await;

        let ffmpeg_task_clone = ffmpeg_task.clone();

        match &ffmpeg_task_guard.task_type {
            FfmpegTaskType::ExtractAudio {
                video_file_path, ..
            } => {
                let video_file_path = video_file_path.clone();
                drop(ffmpeg_task_guard);
                let ffmpeg_result = tokio::task::spawn_blocking(move || {
                    let info = get_video_audio_streams_info(&video_file_path);
                    if let Some(info) = info {
                        let result = FfmpegAudioExtractTaskResult {
                            audio_streams: info
                                .audio_streams
                                .iter()
                                .skip(1)
                                .map(|s| AudioStreamFilePath {
                                    path: get_audio_file_path(&video_file_path, s.index, "m4a"),
                                    index: s.index,
                                })
                                .collect(),
                        };

                        let maps = result
                            .audio_streams
                            .iter()
                            .map(|s| format!("-map 0:{} -c:a aac -b:a 192k {}", s.index, s.path))
                            .collect::<Vec<_>>()
                            .join(" ");

                        let mut ffmpeg_child = FfmpegCommand::new()
                            .input(&video_file_path)
                            .arg("-y")
                            .args(maps.split_whitespace())
                            .spawn()
                            .unwrap();

                        ffmpeg_child.iter().unwrap().for_each(|e| match e {
                            FfmpegEvent::Log(LogLevel::Error, e) => {
                                println!("Error while running ffmpeg: {e}")
                            }
                            FfmpegEvent::Progress(p) => {
                                let ffmpeg_task_clone = ffmpeg_task_clone.clone();
                                tokio::spawn(async move {
                                    let mut ffmpeg_task = ffmpeg_task_clone.write().await;
                                    let progress = pase_duration(&p.time) / info.duration;
                                    ffmpeg_task.status = FfmpegTaskStatus::InProgress {progress};
                                    drop(ffmpeg_task);
                                    emit_ffmpeg_queue_status().await;
                                    println!("ffmpeg progress: {}%", progress * 100.0);
                                });
                            },
                            _ => {}
                        });

                        Some(result)
                    } else {
                        None
                    }
                })
                    .await
                    .unwrap();

                let mut ffmpeg_task = ffmpeg_task.write().await;
                ffmpeg_task.status = FfmpegTaskStatus::Finished;
                if let FfmpegTaskType::ExtractAudio { on_complete, result, .. } = &mut ffmpeg_task.task_type {
                    *result = ffmpeg_result.clone();
                    if let Some(sender) = on_complete.take() {
                        sender.send(ffmpeg_result.unwrap()).unwrap();
                    }
                }
                drop(ffmpeg_task);
            },
            FfmpegTaskType::ExportVideo {  } => todo!()
        };

        emit_ffmpeg_queue_status().await;

        let app_handle = APP_HANDLE.get().unwrap();
        let queue = app_handle.state::<FfmpegTasksQueue>();
        let queue_lock = queue.lock().await;

        run_next_task(queue_lock).await;

        // tokio::spawn(async move {
        //
        //     run_next_task(queue_lock).await;
        // });
    }
}

pub async fn enqueue_extract_audio_task(
    queue: &FfmpegTasksQueue,
    path: String,
    on_complete: Option<oneshot::Sender<FfmpegAudioExtractTaskResult>>,
) {
    enqueue_ffmpeg_task(
        queue,
        FfmpegTask::new(FfmpegTaskType::extract_audio(path, on_complete)),
    )
    .await;
}


async fn emit_ffmpeg_queue_status() {
    let app_handle = APP_HANDLE.get().unwrap();
    let queue = app_handle.state::<FfmpegTasksQueue>();
    let queue_lock = queue.lock().await;
    let tasks = futures::future::join_all(
        queue_lock
            .iter()
            .map(|task| async { task.read().await.clone() })
    ).await;
    drop(queue_lock);
    app_handle
        .emit("ffmpeg-queue", tasks)
        .unwrap();
}