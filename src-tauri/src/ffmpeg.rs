use crate::APP_HANDLE;
use crate::ffmpeg_export_command::{ExportOptions, GpuAcceleration};
use crate::ffmpeg_time_duration::FfmpegTimeDuration;
use crate::ffprobe::{get_video_audio_streams_info, get_video_streams_info};
use crate::select_new_video_file_command::AudioStreamFilePath;
use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use ffmpeg_sidecar::command::{ffmpeg_is_installed, FfmpegCommand};
use ffmpeg_sidecar::event::{FfmpegEvent, FfmpegProgress, LogLevel};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::sync::Arc;
use ffmpeg_sidecar::paths::ffmpeg_path;
use log::{debug, error, info, log, trace};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex, MutexGuard, RwLock, oneshot};
use crate::ffmpeg_download::download_with_progress;

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
    InProgress { progress: f64 },
    Finished,
    Failed,
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
        options: ExportOptions,
        result: Option<FfmpegExportVideoTaskResult>,
    },
    DownloadFfmpeg {
        result: Option<FfmpegDownloadTaskResult>,
    }
}

impl Clone for FfmpegTaskType {
    fn clone(&self) -> Self {
        match self {
            FfmpegTaskType::ExtractAudio {
                video_file_path,
                result,
                on_complete: _on_complete,
            } => FfmpegTaskType::ExtractAudio {
                video_file_path: video_file_path.clone(),
                result: result.clone(),
                on_complete: None,
            },
            FfmpegTaskType::ExportVideo { options, result } => FfmpegTaskType::ExportVideo {
                options: options.clone(),
                result: result.clone(),
            },
            FfmpegTaskType::DownloadFfmpeg {result} => FfmpegTaskType::DownloadFfmpeg {
                result: result.clone()
            },
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
pub struct FfmpegAudioExtractTaskResult {
    pub audio_streams: Vec<AudioStreamFilePath>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
pub struct FfmpegExportVideoTaskResult {
    pub output_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
pub struct FfmpegDownloadTaskResult {
    pub already_installed: bool,
}

impl FfmpegTaskType {
    pub fn extract_audio(path: String, on_complete: Option<oneshot::Sender<FfmpegAudioExtractTaskResult>>) -> Self {
        Self::ExtractAudio {
            video_file_path: path,
            result: None,
            on_complete,
        }
    }

    pub fn export_video(options: ExportOptions) -> Self {
        Self::ExportVideo { options, result: None }
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
        if matches!(task.read().await.status, FfmpegTaskStatus::InProgress { .. }) {
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
    let audio_file_name = format!("audio_{}_{}.{}", BASE64_STANDARD.encode(video_file_path), audio_stream_index, format);

    tmp_folder.join(audio_file_name).to_string_lossy().to_string()
}

#[allow(clippy::manual_async_fn)] // Recursive async function (Send is not auto implements)
fn run_ffmpeg_task(ffmpeg_task: Arc<RwLock<FfmpegTask>>) -> impl Future<Output = ()> + Send {
    async move {
        {
            let mut ffmpeg_task_guard = ffmpeg_task.write().await;
            ffmpeg_task_guard.status = FfmpegTaskStatus::InProgress { progress: 0.0 };
        }

        emit_ffmpeg_queue_status().await;
        set_main_window_progress_bar(Some(0.0));

        let ffmpeg_task_guard = ffmpeg_task.read().await;

        let ffmpeg_task_clone = ffmpeg_task.clone();

        match &ffmpeg_task_guard.task_type {
            FfmpegTaskType::ExtractAudio { video_file_path, .. } => {
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
                        
                        if maps.is_empty() {
                            return Some(result);
                        }

                        let mut ffmpeg_child = FfmpegCommand::new()
                            .input(&video_file_path)
                            .arg("-y")
                            .args(maps.split_whitespace())
                            .spawn()
                            .unwrap();

                        ffmpeg_child.iter().unwrap().for_each(|e| match e {
                            FfmpegEvent::Log(LogLevel::Error | LogLevel::Fatal, e) => {
                                error!("Ffmpeg: {e}")
                            }
                            FfmpegEvent::Log(log_level, s) => {
                                info!("Ffmpeg: {s}")
                            }
                            FfmpegEvent::Progress(p) => {
                                handle_ffmpeg_progress(p, &ffmpeg_task_clone, info.duration);
                            }
                            _ => {}
                        });

                        let exit_status = ffmpeg_child.wait();
                        debug!("Ffmpeg exited with status: {:?}", exit_status);

                        let successful = exit_status.map(|s| s.success()).unwrap_or(false);

                        if successful {
                            Some(result)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                })
                    .await
                    .ok()
                    .flatten();

                let mut ffmpeg_task = ffmpeg_task.write().await;
                if ffmpeg_result.is_some() {
                    ffmpeg_task.status = FfmpegTaskStatus::Finished;
                    if let FfmpegTaskType::ExtractAudio { on_complete, result, .. } = &mut ffmpeg_task.task_type {
                        *result = ffmpeg_result.clone();
                        if let Some(sender) = on_complete.take() {
                            sender.send(ffmpeg_result.unwrap()).unwrap();
                        }
                    }
                } else {
                    ffmpeg_task.status = FfmpegTaskStatus::Failed;
                }
                drop(ffmpeg_task);
            }
            FfmpegTaskType::ExportVideo { options, .. } => {
                let options = options.clone();
                drop(ffmpeg_task_guard);

                let ffmpeg_result = tokio::task::spawn_blocking(move || {
                    let app_handle = APP_HANDLE.get().unwrap();
                    if !app_handle.asset_protocol_scope().is_allowed(&options.input_path) {
                        return None;
                    }

                    let info = get_video_streams_info(&options.input_path);
                    if let Some(info) = info {
                        let input_video_codec = info.streams.first().map(|s| s.codec_name.clone());

                        let gpu_acceleration = {
                            match options.gpu_acceleration {
                                Some(GpuAcceleration::Nvidia) => {
                                    let nvidia_gpu_args = "-hwaccel cuda -hwaccel_output_format cuda";
                                    let gpu_scale_arg = "scale_cuda";

                                    match &input_video_codec.as_deref() {
                                        Some("h264") => Some((nvidia_gpu_args, "h264_cuvid", gpu_scale_arg)),
                                        Some("hevc") => Some((nvidia_gpu_args, "hevc_cuvid", gpu_scale_arg)),
                                        Some("av1") => Some((nvidia_gpu_args, "av1_cuvid", gpu_scale_arg)),
                                        _ => None,
                                    }
                                }
                                None => None,
                            }
                        };

                        let scale = if let Some(resolution) = options.resolution {
                            let scale_filter = gpu_acceleration.map(|(_, _, scale_filter)| scale_filter).unwrap_or("scale");
                            Cow::Owned(format!(",{}={}", scale_filter, resolution))
                        } else {
                            Cow::Borrowed("")
                        };

                        let video_filter = format!("[0:v]setpts=PTS-STARTPTS{}[v]", scale);

                        let audio_filter = if !options.active_audio_streams.is_empty() {
                            let audio_streams_trim = options
                                .active_audio_streams
                                .iter()
                                .map(|stream| format!("[0:{}]volume={},asetpts=PTS-STARTPTS[a{}];", stream.index, stream.gain, stream.index))
                                .collect::<Vec<_>>()
                                .join("");

                            let audio_streams = options
                                .active_audio_streams
                                .iter()
                                .map(|stream| format!("[a{}]", stream.index))
                                .collect::<Vec<_>>()
                                .join("");

                            format!(
                                "{}{}amix=inputs={}[a]",
                                audio_streams_trim,
                                audio_streams,
                                options.active_audio_streams.len()
                            )
                        } else {
                            // Generate silence
                            format!("aevalsrc=0:d={}[a]", options.end_time - options.start_time)
                        };

                        let mut ffmpeg_command = FfmpegCommand::new();

                        if let Some((args, codec, _)) = gpu_acceleration {
                            ffmpeg_command.args(args.split_whitespace());
                            ffmpeg_command.codec_video(codec);
                        }

                        ffmpeg_command.seek(options.start_time.to_string().as_str());
                        ffmpeg_command.to(options.end_time.to_string().as_str());

                        ffmpeg_command
                            .input(&options.input_path)
                            .overwrite()
                            .filter_complex(format!("{};{}", video_filter, audio_filter))
                            //.filter_complex(format!("\"{}\"", audio_filter))
                            .map("[v]")
                            .map("[a]");

                        if let Some(codec) = options.video_codec {
                            ffmpeg_command.codec_video(codec);
                        }

                        if let Some(bitrate) = options.bitrate {
                            ffmpeg_command.args(vec!["-b:v", &bitrate]);
                        }

                        if let Some(frame_rate) = options.frame_rate {
                            ffmpeg_command.arg("-r");
                            ffmpeg_command.arg(frame_rate.to_string().as_str());
                        }

                        ffmpeg_command.preset("medium").output(&options.output_path);

                        trace!("Running ffmpeg command: {:?}", ffmpeg_command.print_command());

                        let mut ffmpeg_child = ffmpeg_command.spawn().unwrap();

                        ffmpeg_child.iter().unwrap().for_each(|e| match e {
                            FfmpegEvent::Log(LogLevel::Error | LogLevel::Fatal, e) => {
                                error!("Ffmpeg: {e}")
                            }
                            FfmpegEvent::Log(log_level, s) => {
                                info!("Ffmpeg: {s}")
                            }
                            FfmpegEvent::Progress(p) => {
                                handle_ffmpeg_progress(p, &ffmpeg_task_clone, options.end_time - options.start_time);
                            }
                            _ => {}
                        });

                        let exit_status = ffmpeg_child.wait();
                        debug!("Ffmpeg exited with status: {:?}", exit_status);

                        let successful = exit_status.map(|s| s.success()).unwrap_or(false);

                        if successful {
                            let result = FfmpegExportVideoTaskResult {
                                output_path: options.output_path.clone(),
                            };

                            Some(result)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                })
                    .await
                    .ok()
                    .flatten();

                let mut ffmpeg_task = ffmpeg_task.write().await;
                if ffmpeg_result.is_some() {
                    ffmpeg_task.status = FfmpegTaskStatus::Finished;
                    if let FfmpegTaskType::ExportVideo { result, .. } = &mut ffmpeg_task.task_type {
                        *result = ffmpeg_result.clone();
                    }
                } else {
                    ffmpeg_task.status = FfmpegTaskStatus::Failed;
                }
                drop(ffmpeg_task);
            }
            FfmpegTaskType::DownloadFfmpeg { .. } => {
                drop(ffmpeg_task_guard);
                let ffmpeg_task_clone = ffmpeg_task.clone();

                let ffmpeg_result = tokio::task::spawn_blocking(move || {
                    let ffmpeg_is_installed = ffmpeg_is_installed();

                    info!("FFmpeg is installed: {} (ffmpeg path: {:?})", ffmpeg_is_installed, ffmpeg_path().to_str());

                    if ffmpeg_path().to_str() != Some("ffmpeg") && ffmpeg_is_installed {
                        return Ok(true)
                    }

                    info!("Downloading ffmpeg...");

                    download_with_progress(|progress| {
                        let ffmpeg_task_clone = ffmpeg_task_clone.clone();
                        tokio::spawn(async move {
                            let mut ffmpeg_task = ffmpeg_task_clone.write().await;
                            ffmpeg_task.status = FfmpegTaskStatus::InProgress { progress };
                            drop(ffmpeg_task);
                            emit_ffmpeg_queue_status().await;
                            set_main_window_progress_bar(Some(progress));
                        });
                    })?;

                    info!("Ffmpeg downloaded successfully! ({:?})", ffmpeg_path().to_str());

                    Ok::<bool, anyhow::Error>(false)
                })
                    .await
                    .map_err(anyhow::Error::msg)
                    .flatten();

                let mut ffmpeg_task = ffmpeg_task.write().await;
                if let Ok(already_installed) = ffmpeg_result {
                    ffmpeg_task.status = FfmpegTaskStatus::Finished;
                    if let FfmpegTaskType::DownloadFfmpeg { result, .. } = &mut ffmpeg_task.task_type {
                        *result = Some(FfmpegDownloadTaskResult {
                            already_installed,
                        })
                    }
                } else if let Err(e) = ffmpeg_result {
                    ffmpeg_task.status = FfmpegTaskStatus::Failed;
                    error!("Failed to download ffmpeg: {e}");
                }
                drop(ffmpeg_task);
            }
        };

        emit_ffmpeg_queue_status().await;
        set_main_window_progress_bar(None);

        let app_handle = APP_HANDLE.get().unwrap();
        let queue = app_handle.state::<FfmpegTasksQueue>();
        let queue_lock = queue.lock().await;

        run_next_task(queue_lock).await;
    }
}

pub async fn enqueue_extract_audio_task(queue: &FfmpegTasksQueue, path: String, on_complete: Option<oneshot::Sender<FfmpegAudioExtractTaskResult>>) {
    enqueue_ffmpeg_task(queue, FfmpegTask::new(FfmpegTaskType::extract_audio(path, on_complete))).await;
}

pub async fn enqueue_export_video_task(queue: &FfmpegTasksQueue, options: ExportOptions) {
    enqueue_ffmpeg_task(queue, FfmpegTask::new(FfmpegTaskType::export_video(options))).await;
}

pub async fn enqueue_download_ffmpeg_task(queue: &FfmpegTasksQueue) {
    enqueue_ffmpeg_task(queue, FfmpegTask::new(FfmpegTaskType::DownloadFfmpeg {result: None})).await;
}

pub async fn emit_ffmpeg_queue_status() {
    let app_handle = APP_HANDLE.get().unwrap();
    let queue = app_handle.state::<FfmpegTasksQueue>();
    let queue_lock = queue.lock().await;
    let tasks = futures::future::join_all(queue_lock.iter().map(|task| async { task.read().await.clone() })).await;
    drop(queue_lock);
    app_handle.emit("ffmpeg-queue", tasks).unwrap();
}

fn handle_ffmpeg_progress(p: FfmpegProgress, ffmpeg_task: &Arc<RwLock<FfmpegTask>>, total_duration: f64) {
    let ffmpeg_task_clone = ffmpeg_task.clone();
    info!("FFmpeg progress event: {:?}", p);
    tokio::spawn(async move {
        let mut ffmpeg_task = ffmpeg_task_clone.write().await;
        let progress = FfmpegTimeDuration::from_str(&p.time)
            .map(FfmpegTimeDuration::as_seconds)
            .unwrap_or_default()
            / total_duration;
        ffmpeg_task.status = FfmpegTaskStatus::InProgress { progress };
        drop(ffmpeg_task);
        emit_ffmpeg_queue_status().await;
        set_main_window_progress_bar(Some(progress));
        // println!("ffmpeg progress: {}%", progress * 100.0);
    });
}

fn set_main_window_progress_bar(progress: Option<f64>) {
    let app_handle = APP_HANDLE.get().unwrap();
    let main_window = app_handle.get_webview_window("main").unwrap();

    if let Some(progress) = progress {
        if progress != 0.0 {
            main_window
                .set_progress_bar(ProgressBarState {
                    status: Some(ProgressBarStatus::Normal),
                    progress: Some((progress * 100.0) as u64),
                })
                .unwrap();
        } else {
            main_window
                .set_progress_bar(ProgressBarState {
                    status: Some(ProgressBarStatus::Indeterminate),
                    progress: None,
                })
                .unwrap();
        }
    } else {
        main_window
            .set_progress_bar(ProgressBarState {
                status: Some(ProgressBarStatus::None),
                progress: None,
            })
            .unwrap();
    }
}
