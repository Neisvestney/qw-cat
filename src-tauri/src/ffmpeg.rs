use crate::APP_HANDLE;
use crate::ffmpeg_download::download_with_progress;
use crate::ffmpeg_export_command::{ExportOptions, GpuAcceleration};
use crate::ffmpeg_path::{ffmpeg_path, source_is_available};
use crate::ffmpeg_settings::FfmpegSource;
use crate::ffmpeg_time_duration::FfmpegTimeDuration;
use crate::ffprobe::{get_video_audio_streams_info, get_video_streams_info};
use crate::select_new_video_file_command::AudioStreamFilePath;
use crate::temp_cleanup::media_cache_dir;
use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use ffmpeg_sidecar::command::FfmpegCommand;
use ffmpeg_sidecar::event::{FfmpegEvent, FfmpegProgress, LogLevel};
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::ChildStdin;
use std::sync::Arc;
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{Emitter, Manager, async_runtime};
use tokio::sync::{Mutex, MutexGuard, RwLock, mpsc, oneshot};

const WEB_SUPPORTED_AUDIO_CODECS: [&str; 9] = [
    "aac",       // AAC (MP4/M4A) – all modern browsers
    "mp3",       // MP3 – all browsers
    "opus",      // Opus (WebM/Ogg) – Chrome, Firefox, Edge, Safari (modern)
    "vorbis",    // Vorbis (Ogg/WebM) – Chrome, Firefox, Edge
    "flac",      // FLAC – Chrome, Firefox, Edge, Safari
    "alac",      // ALAC (MP4/M4A) – Safari, modern Chrome
    "pcm_s16le", // WAV PCM 16-bit
    "pcm_s24le", // WAV PCM 24-bit
    "pcm_f32le", // WAV PCM float
];

const WEB_SUPPORTED_AUDIO_CODECS_CONTAINERS: [&str; 9] = [
    "m4a",  // aac
    "mp3",  // mp3
    "ogg",  // opus
    "ogg",  // vorbis
    "flac", // flac
    "m4a",  // alac
    "wav",  // pcm_s16le
    "wav",  // pcm_s24le
    "wav",  // pcm_f32le
];

#[derive(Debug, Serialize, Deserialize, ts_rs::TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FfmpegTask {
    status: FfmpegTaskStatus,
    task_type: FfmpegTaskType,
    #[serde(skip)]
    ffmpeg_stdin: Option<mpsc::Sender<String>>,
}

impl FfmpegTask {
    pub fn new(task_type: FfmpegTaskType) -> Self {
        Self {
            status: FfmpegTaskStatus::Queued,
            task_type,
            ffmpeg_stdin: None,
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
    Cancelled,
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
    },
    RemuxVideo {
        video_file_path: String,
        result: Option<FfmpegRemuxVideoTaskResult>,
        #[serde(skip)]
        on_complete: Option<oneshot::Sender<FfmpegRemuxVideoTaskResult>>,
    },
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
            FfmpegTaskType::DownloadFfmpeg { result } => FfmpegTaskType::DownloadFfmpeg { result: result.clone() },
            FfmpegTaskType::RemuxVideo {
                video_file_path,
                result,
                on_complete: _on_complete,
            } => FfmpegTaskType::RemuxVideo {
                video_file_path: video_file_path.clone(),
                result: result.clone(),
                on_complete: None,
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

#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
pub struct FfmpegRemuxVideoTaskResult {
    pub output_path: String,
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

    pub fn remux_video(path: String, on_complete: Option<oneshot::Sender<FfmpegRemuxVideoTaskResult>>) -> Self {
        Self::RemuxVideo {
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
        if matches!(task.read().await.status, FfmpegTaskStatus::InProgress { .. }) {
            has_in_progress = true;
            break;
        }

        if first_queued_task.is_none() && matches!(task.read().await.status, FfmpegTaskStatus::Queued) {
            first_queued_task = Some(task.clone());
        }
    }

    if !has_in_progress && let Some(next_task) = first_queued_task {
        // Marked while the queue is still locked, otherwise a concurrent call could start the same task twice
        next_task.write().await.status = FfmpegTaskStatus::InProgress { progress: 0.0 };
        drop(queue);
        tokio::spawn(run_ffmpeg_task(next_task));
    }
}

fn get_audio_file_path(video_file_path: &str, audio_stream_index: i32, format: &str) -> String {
    let tmp_folder = media_cache_dir();
    std::fs::create_dir_all(tmp_folder).unwrap();
    let audio_file_name = format!("audio_{}_{}.{}", BASE64_STANDARD.encode(video_file_path), audio_stream_index, format);

    tmp_folder.join(audio_file_name).to_string_lossy().to_string()
}

const MP4_COPYABLE_AUDIO_CODECS: [&str; 5] = ["aac", "mp3", "alac", "flac", "opus"];

fn get_playback_copy_path(video_file_path: &str, source_metadata: &std::fs::Metadata) -> std::path::PathBuf {
    use std::hash::{DefaultHasher, Hash, Hasher};

    let tmp_folder = media_cache_dir();
    std::fs::create_dir_all(tmp_folder).unwrap();
    // Size and mtime are part of the key so a replaced source never reuses a stale copy
    let mut hasher = DefaultHasher::new();
    video_file_path.hash(&mut hasher);
    source_metadata.len().hash(&mut hasher);
    source_metadata.modified().ok().hash(&mut hasher);

    tmp_folder.join(format!("playback_{:016x}.mp4", hasher.finish()))
}

// Only this process's own copy is replaced, another running instance may still be playing its copy from the same dir
static LAST_PLAYBACK_COPY: std::sync::Mutex<Option<std::path::PathBuf>> = std::sync::Mutex::new(None);

// Each copy is as large as its source, so only the one for the current video is kept
fn replace_last_playback_copy(current: &std::path::Path) {
    let mut last = LAST_PLAYBACK_COPY.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(previous) = last.replace(current.to_path_buf())
        && previous != current
    {
        let _ = std::fs::remove_file(previous);
    }
}

// Rewraps the first video and audio streams into mp4 for containers the webview can't play (e.g. MPEG-TS)
fn remux_for_playback(video_file_path: &str, ffmpeg_task: &Arc<RwLock<FfmpegTask>>) -> Option<FfmpegRemuxVideoTaskResult> {
    let source_metadata = std::fs::metadata(video_file_path).ok()?;
    let output_path = get_playback_copy_path(video_file_path, &source_metadata);
    let result = FfmpegRemuxVideoTaskResult {
        output_path: output_path.to_string_lossy().to_string(),
    };

    if output_path.exists() {
        info!("Reusing playback copy {:?}", output_path);
        replace_last_playback_copy(&output_path);
        return Some(result);
    }

    let video_info = get_video_streams_info(video_file_path)?;
    let video_codec = video_info.streams.first().map(|s| s.codec_name.as_str());
    let format_name = video_info.format.format_name.as_deref().unwrap_or_default();

    // An mp4 that fails to play has an unsupported codec, which a remux can't fix. The exception is
    // HEVC on WebKit, which only plays it when tagged hvc1
    let is_mp4_family = format_name.split(',').any(|f| f == "mp4" || f == "mov");
    let needs_hvc1_tag = cfg!(target_os = "macos") && video_codec == Some("hevc");
    if is_mp4_family && !needs_hvc1_tag {
        info!("Skipping playback copy: {format_name} with {video_codec:?} won't play after a remux either");
        return None;
    }

    let audio_info = get_video_audio_streams_info(video_file_path)?;

    replace_last_playback_copy(&output_path);

    // Written under a temporary name so an interrupted remux is never reused as a finished copy
    let part_path = output_path.with_extension("mp4.part");

    let mut ffmpeg_command = FfmpegCommand::new_with_path(ffmpeg_path());
    ffmpeg_command
        .input(video_file_path)
        .args(["-y", "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy"]);

    match audio_info.audio_streams.first() {
        Some(stream) if MP4_COPYABLE_AUDIO_CODECS.contains(&stream.codec_name.as_str()) => {
            ffmpeg_command.args(["-c:a", "copy"]);
        }
        _ => {
            ffmpeg_command.args(["-c:a", "aac", "-b:a", "192k"]);
        }
    }

    if video_codec == Some("hevc") {
        ffmpeg_command.args(["-tag:v", "hvc1"]);
    }

    ffmpeg_command.args(["-f", "mp4"]).output(part_path.to_string_lossy());

    let completed = run_remux_command(&mut ffmpeg_command, ffmpeg_task, audio_info.duration);
    // ffmpeg exits cleanly on "q", so a cancelled remux looks successful but leaves a truncated file
    let cancelled = ffmpeg_task.blocking_read().status == FfmpegTaskStatus::Cancelled;

    if !completed || cancelled || std::fs::rename(&part_path, &output_path).is_err() {
        let _ = std::fs::remove_file(&part_path);
        return None;
    }

    Some(result)
}

fn run_remux_command(ffmpeg_command: &mut FfmpegCommand, ffmpeg_task: &Arc<RwLock<FfmpegTask>>, duration: f64) -> bool {
    info!("Running ffmpeg task: {:?}", ffmpeg_command.print_command());

    let Ok(mut ffmpeg_child) = ffmpeg_command.spawn() else {
        return false;
    };

    if let Some(child_std_in) = ffmpeg_child.take_stdin() {
        async_runtime::spawn(handle_ffmpeg_stdin(child_std_in, ffmpeg_task.clone()));
    }

    let Ok(events) = ffmpeg_child.iter() else {
        let _ = ffmpeg_child.kill();
        let _ = ffmpeg_child.wait();
        return false;
    };

    events.for_each(|e| match e {
        FfmpegEvent::Log(LogLevel::Error | LogLevel::Fatal, e) => {
            error!("Ffmpeg: {e}")
        }
        FfmpegEvent::Log(_log_level, s) => {
            info!("Ffmpeg: {s}")
        }
        FfmpegEvent::Progress(p) => {
            handle_ffmpeg_progress(p, ffmpeg_task, duration);
        }
        _ => {}
    });

    let exit_status = ffmpeg_child.wait();
    debug!("Ffmpeg exited with status: {:?}", exit_status);

    exit_status.map(|s| s.success()).unwrap_or(false)
}

// Pinned to 8-bit 4:2:0, otherwise 10-bit sources give High 10 / 10-bit streams that browsers and Discord can't play
fn output_pix_fmt(video_codec: Option<&str>) -> Option<&'static str> {
    match video_codec {
        Some("prores_ks") => Some("yuv422p10le"),
        Some("prores_videotoolbox") => Some("p210le"),
        // paletteuse already outputs pal8
        Some("gif") => None,
        Some(codec) if codec.ends_with("_nvenc") || codec.ends_with("_amf") || codec.ends_with("_qsv") || codec.ends_with("_videotoolbox") => {
            Some("nv12")
        }
        _ => Some("yuv420p"),
    }
}

#[allow(clippy::manual_async_fn)] // Recursive async function (Send is not auto implements)
fn run_ffmpeg_task(ffmpeg_task: Arc<RwLock<FfmpegTask>>) -> impl Future<Output = ()> + Send {
    async move {
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
                        struct AudioStreamMap<'a> {
                            index: i32,
                            path: String,
                            ffmpeg_map: &'a str,
                        }

                        let audio_streams: Vec<_> = info
                            .audio_streams
                            .iter()
                            .skip(1)
                            .map(|steam| {
                                let (format, _codec_name, ffmpeg_map) =
                                    if let Some(index) = WEB_SUPPORTED_AUDIO_CODECS.iter().position(|c| c == &steam.codec_name) {
                                        (
                                            WEB_SUPPORTED_AUDIO_CODECS_CONTAINERS.get(index).unwrap(),
                                            WEB_SUPPORTED_AUDIO_CODECS.get(index).unwrap(),
                                            "-c:a copy",
                                        )
                                    } else {
                                        (&"m4a", &"aac", "-c:a aac -b:a 192k")
                                    };

                                AudioStreamMap {
                                    index: steam.index,
                                    path: get_audio_file_path(&video_file_path, steam.index, format),
                                    ffmpeg_map,
                                }
                            })
                            .collect();

                        let result = FfmpegAudioExtractTaskResult {
                            audio_streams: audio_streams
                                .iter()
                                .map(|s| AudioStreamFilePath {
                                    path: s.path.clone(),
                                    index: s.index,
                                })
                                .collect(),
                        };

                        let maps = audio_streams
                            .iter()
                            .map(|s| format!("-map 0:{} {} {}", s.index, s.ffmpeg_map, s.path))
                            .collect::<Vec<_>>()
                            .join(" ");

                        if maps.is_empty() {
                            return Some(result);
                        }

                        let mut ffmpeg_command = FfmpegCommand::new_with_path(ffmpeg_path());

                        ffmpeg_command.input(&video_file_path).arg("-y").args(maps.split_whitespace());

                        info!("Running ffmpeg task: {:?}", ffmpeg_command.print_command());

                        let mut ffmpeg_child = ffmpeg_command.spawn().unwrap();

                        ffmpeg_child.iter().unwrap().for_each(|e| match e {
                            FfmpegEvent::Log(LogLevel::Error | LogLevel::Fatal, e) => {
                                error!("Ffmpeg: {e}")
                            }
                            FfmpegEvent::Log(_log_level, s) => {
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

                        if successful { Some(result) } else { None }
                    } else {
                        None
                    }
                })
                .await
                .ok()
                .flatten();

                let mut ffmpeg_task = ffmpeg_task.write().await;
                if let Some(ffmpeg_result) = ffmpeg_result.clone() {
                    ffmpeg_task.status = FfmpegTaskStatus::Finished;
                    if let FfmpegTaskType::ExtractAudio { on_complete, result, .. } = &mut ffmpeg_task.task_type {
                        *result = Some(ffmpeg_result.clone());
                        if let Some(sender) = on_complete.take() {
                            sender.send(ffmpeg_result).unwrap();
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

                                    match &input_video_codec.as_deref() {
                                        Some("h264") => Some((nvidia_gpu_args, "h264_cuvid")),
                                        Some("hevc") => Some((nvidia_gpu_args, "hevc_cuvid")),
                                        Some("av1") => Some((nvidia_gpu_args, "av1_cuvid")),
                                        _ => None,
                                    }
                                }
                                // AMF/QSV/VideoToolbox encoders take software frames, so decoding and scaling stay on the CPU
                                Some(GpuAcceleration::Amd | GpuAcceleration::Intel | GpuAcceleration::Apple) | None => None,
                            }
                        };

                        let video_codec = options.video_codec.as_deref();
                        let has_audio = !matches!(video_codec, Some("gif" | "libwebp_anim"));

                        let mut video_filter = String::from("[0:v]setpts=PTS-STARTPTS");
                        if gpu_acceleration.is_some() {
                            // Frames stay in CUDA memory where -pix_fmt can't reach, so scale_cuda does the 8-bit conversion
                            match &options.resolution {
                                Some(resolution) => video_filter.push_str(&format!(",scale_cuda={resolution}:format=nv12")),
                                None => video_filter.push_str(",scale_cuda=format=nv12"),
                            }
                        } else if let Some(resolution) = &options.resolution {
                            video_filter.push_str(&format!(",scale={resolution}"));
                        }
                        if video_codec == Some("gif") {
                            if let Some(frame_rate) = options.frame_rate {
                                video_filter.push_str(&format!(",fps={frame_rate}"));
                            }
                            video_filter.push_str(
                                ",split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                            );
                        }
                        video_filter.push_str("[v]");

                        let audio_streams = &options.active_audio_streams;
                        let separate_audio = !options.mix_audio_streams && !audio_streams.is_empty();

                        // libopus rejects 5.1(side) and other non-standard layouts, so remap them to the nearest standard one
                        let audio_format = if options.audio_codec.as_deref() == Some("libopus") {
                            ",aformat=channel_layouts=7.1|5.1|stereo|mono"
                        } else {
                            ""
                        };

                        let audio_streams_trim = audio_streams
                            .iter()
                            .map(|stream| {
                                format!(
                                    "[0:{}]volume={},asetpts=PTS-STARTPTS{}[a{}]",
                                    stream.index, stream.gain, audio_format, stream.index
                                )
                            })
                            .collect::<Vec<_>>()
                            .join(";");

                        let audio_filter = if separate_audio {
                            audio_streams_trim
                        } else if !audio_streams.is_empty() {
                            let audio_streams_labels = audio_streams.iter().map(|stream| format!("[a{}]", stream.index)).collect::<String>();
                            format!("{};{}amix=inputs={}[a]", audio_streams_trim, audio_streams_labels, audio_streams.len())
                        } else {
                            // Generate silence
                            format!("aevalsrc=0:d={}[a]", options.end_time - options.start_time)
                        };

                        let audio_outputs: Vec<(String, Option<&String>)> = if separate_audio {
                            audio_streams
                                .iter()
                                .map(|stream| (format!("[a{}]", stream.index), stream.bitrate.as_ref()))
                                .collect()
                        } else {
                            vec![("[a]".to_string(), options.audio_bitrate.as_ref())]
                        };

                        let mut ffmpeg_command = FfmpegCommand::new_with_path(ffmpeg_path());

                        if let Some((args, codec)) = gpu_acceleration {
                            ffmpeg_command.args(args.split_whitespace());
                            ffmpeg_command.codec_video(codec);
                        }

                        ffmpeg_command.seek(options.start_time.to_string().as_str());
                        ffmpeg_command.to(options.end_time.to_string().as_str());

                        ffmpeg_command.input(&options.input_path).overwrite();
                        if has_audio {
                            ffmpeg_command.filter_complex(format!("{};{}", video_filter, audio_filter)).map("[v]");
                            for (label, _) in &audio_outputs {
                                ffmpeg_command.map(label);
                            }

                            if let Some(audio_codec) = &options.audio_codec {
                                ffmpeg_command.codec_audio(audio_codec);
                            }
                            // FLAC is lossless and ignores -b:a
                            if options.audio_codec.as_deref() != Some("flac") {
                                for (output_index, (_, bitrate)) in audio_outputs.iter().enumerate() {
                                    if let Some(bitrate) = bitrate {
                                        ffmpeg_command.arg(format!("-b:a:{output_index}")).arg(bitrate);
                                    }
                                }
                            }
                        } else {
                            ffmpeg_command.filter_complex(video_filter).map("[v]");
                        }

                        if let Some(codec) = video_codec {
                            ffmpeg_command.codec_video(codec);
                        }

                        if gpu_acceleration.is_none()
                            && let Some(pix_fmt) = output_pix_fmt(video_codec)
                        {
                            ffmpeg_command.pix_fmt(pix_fmt);
                        }

                        if let Some(bitrate) = &options.bitrate {
                            ffmpeg_command.args(vec!["-b:v", bitrate]);
                        } else if video_codec == Some("libvpx-vp9") {
                            // Without a target libvpx falls back to ~256 kbit/s, so switch to constant quality
                            ffmpeg_command.args(["-crf", "32", "-b:v", "0"]);
                        }

                        // GIF already got its rate from the fps filter before the palette was built
                        if video_codec != Some("gif")
                            && let Some(frame_rate) = options.frame_rate
                        {
                            ffmpeg_command.arg("-r");
                            ffmpeg_command.arg(frame_rate.to_string().as_str());
                        }

                        // Encoder families name their speed presets differently, and libvpx/AMF have no -preset at all
                        let encoder_preset = match video_codec {
                            None | Some("libx264" | "libx265") => Some("medium"),
                            Some("libsvtav1") => Some("8"),
                            Some(codec) if codec.ends_with("_nvenc") => Some("p4"),
                            Some(codec) if codec.ends_with("_qsv") => Some("medium"),
                            _ => None,
                        };
                        if let Some(encoder_preset) = encoder_preset {
                            ffmpeg_command.preset(encoder_preset);
                        }

                        match video_codec {
                            // libvpx defaults to single-threaded "best" quality, which takes ages
                            Some("libvpx-vp9") => {
                                ffmpeg_command.args(["-row-mt", "1", "-deadline", "good", "-cpu-used", "4"]);
                            }
                            // 422 HQ, tagged as Apple's own encoder so editors don't warn about it
                            Some("prores_ks") => {
                                ffmpeg_command.args(["-profile:v", "3", "-vendor", "apl0"]);
                            }
                            Some("prores_videotoolbox") => {
                                ffmpeg_command.args(["-profile:v", "hq"]);
                            }
                            // The webp muxer plays once by default, unlike gif
                            Some("libwebp_anim") => {
                                ffmpeg_command.args(["-loop", "0"]);
                            }
                            _ => {}
                        }

                        let output_extension = std::path::Path::new(&options.output_path)
                            .extension()
                            .map(|e| e.to_string_lossy().to_lowercase());
                        let is_mp4_family = matches!(output_extension.as_deref(), Some("mp4" | "mov" | "m4v"));

                        // Apple players only open HEVC in MP4/MOV when it is tagged hvc1 instead of ffmpeg's default hev1
                        let is_hevc = matches!(video_codec, Some(codec) if codec == "libx265" || codec.starts_with("hevc_"));
                        if is_hevc && is_mp4_family {
                            ffmpeg_command.args(["-tag:v", "hvc1"]);
                        }

                        // Moves the index to the front so browsers and messengers start playing before the download ends
                        if is_mp4_family {
                            ffmpeg_command.args(["-movflags", "+faststart"]);
                        }

                        ffmpeg_command.output(&options.output_path);

                        info!("Running ffmpeg command: {:?}", ffmpeg_command.print_command());

                        let mut ffmpeg_child = ffmpeg_command.spawn().unwrap();

                        let child_std_in = ffmpeg_child.take_stdin().unwrap();
                        async_runtime::spawn(handle_ffmpeg_stdin(child_std_in, ffmpeg_task_clone.clone()));

                        ffmpeg_child.iter().unwrap().for_each(|e| match e {
                            FfmpegEvent::Log(LogLevel::Error | LogLevel::Fatal, e) => {
                                error!("Ffmpeg: {e}")
                            }
                            FfmpegEvent::Log(_log_level, s) => {
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
                info!("Task finished: {:?}", ffmpeg_task);
                if ffmpeg_task.status != FfmpegTaskStatus::Cancelled {
                    if ffmpeg_result.is_some() {
                        ffmpeg_task.status = FfmpegTaskStatus::Finished;
                        if let FfmpegTaskType::ExportVideo { result, .. } = &mut ffmpeg_task.task_type {
                            *result = ffmpeg_result.clone();
                        }
                    } else {
                        ffmpeg_task.status = FfmpegTaskStatus::Failed;
                    }
                }
                drop(ffmpeg_task);
            }
            FfmpegTaskType::DownloadFfmpeg { .. } => {
                drop(ffmpeg_task_guard);
                let ffmpeg_task_clone = ffmpeg_task.clone();

                let ffmpeg_result = tokio::task::spawn_blocking(move || {
                    // The downloaded copy specifically, the source may have been switched since this was queued
                    let downloaded = source_is_available(FfmpegSource::Downloaded, None);

                    info!("FFmpeg is downloaded: {downloaded}");

                    if downloaded {
                        return Ok(true);
                    }

                    info!("Downloading ffmpeg...");

                    download_with_progress(|progress| {
                        let ffmpeg_task_clone = ffmpeg_task_clone.clone();
                        tokio::spawn(async move {
                            let mut ffmpeg_task = ffmpeg_task_clone.write().await;
                            // Same as handle_ffmpeg_progress: the last callback can land after the task finished
                            if !matches!(ffmpeg_task.status, FfmpegTaskStatus::InProgress { .. }) {
                                return;
                            }
                            ffmpeg_task.status = FfmpegTaskStatus::InProgress { progress };
                            drop(ffmpeg_task);
                            emit_ffmpeg_queue_status().await;
                            set_main_window_progress_bar(Some(progress));
                        });
                    })?;

                    info!("Ffmpeg downloaded successfully!");

                    Ok::<bool, anyhow::Error>(false)
                })
                .await
                .map_err(anyhow::Error::msg)
                .flatten();

                let mut ffmpeg_task = ffmpeg_task.write().await;
                if let Ok(already_installed) = ffmpeg_result {
                    ffmpeg_task.status = FfmpegTaskStatus::Finished;
                    if let FfmpegTaskType::DownloadFfmpeg { result, .. } = &mut ffmpeg_task.task_type {
                        *result = Some(FfmpegDownloadTaskResult { already_installed })
                    }
                } else if let Err(e) = ffmpeg_result {
                    ffmpeg_task.status = FfmpegTaskStatus::Failed;
                    error!("Failed to download ffmpeg: {e}");
                }
                drop(ffmpeg_task);
            }
            FfmpegTaskType::RemuxVideo { video_file_path, .. } => {
                let video_file_path = video_file_path.clone();
                drop(ffmpeg_task_guard);

                let ffmpeg_result = tokio::task::spawn_blocking(move || remux_for_playback(&video_file_path, &ffmpeg_task_clone))
                    .await
                    .ok()
                    .flatten();

                let mut ffmpeg_task = ffmpeg_task.write().await;
                if ffmpeg_task.status != FfmpegTaskStatus::Cancelled {
                    ffmpeg_task.status = match ffmpeg_result {
                        Some(_) => FfmpegTaskStatus::Finished,
                        None => FfmpegTaskStatus::Failed,
                    };
                }
                if let FfmpegTaskType::RemuxVideo { on_complete, result, .. } = &mut ffmpeg_task.task_type {
                    *result = ffmpeg_result.clone();
                    // Dropping the sender on failure lets the waiting command return instead of hanging
                    if let (Some(sender), Some(ffmpeg_result)) = (on_complete.take(), ffmpeg_result) {
                        let _ = sender.send(ffmpeg_result);
                    }
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

pub async fn enqueue_remux_video_task(queue: &FfmpegTasksQueue, path: String, on_complete: Option<oneshot::Sender<FfmpegRemuxVideoTaskResult>>) {
    enqueue_ffmpeg_task(queue, FfmpegTask::new(FfmpegTaskType::remux_video(path, on_complete))).await;
}

pub async fn enqueue_download_ffmpeg_task(queue: &FfmpegTasksQueue) {
    enqueue_ffmpeg_task(queue, FfmpegTask::new(FfmpegTaskType::DownloadFfmpeg { result: None })).await;
}

pub async fn emit_ffmpeg_queue_status() {
    let app_handle = APP_HANDLE.get().unwrap();
    let queue = app_handle.state::<FfmpegTasksQueue>();
    let queue_lock = queue.lock().await;
    let tasks = futures::future::join_all(queue_lock.iter().map(|task| async { task.read().await.clone() })).await;
    drop(queue_lock);
    app_handle.emit("ffmpeg-queue", tasks).unwrap();
}

async fn handle_ffmpeg_stdin(mut stdin: ChildStdin, ffmpeg_task: Arc<RwLock<FfmpegTask>>) {
    let (tx, mut rx) = mpsc::channel::<String>(100);

    ffmpeg_task.write().await.ffmpeg_stdin.replace(tx);

    while let Some(s) = rx.recv().await {
        debug!("Received ffmpeg stdin: {s}");
        stdin.write_all(s.as_bytes()).unwrap();
    }
}

#[allow(clippy::collapsible_if)]
pub async fn cancel_ffmpeg_task(ffmpeg_task: &Arc<RwLock<FfmpegTask>>) {
    let mut ffmpeg_task = ffmpeg_task.write().await;
    // The stdin channel outlives the process, so a late click must not mark a finished task as cancelled
    if !matches!(ffmpeg_task.status, FfmpegTaskStatus::InProgress { .. }) {
        return;
    }
    if let Some(ffmpeg_stdin) = &ffmpeg_task.ffmpeg_stdin {
        if ffmpeg_stdin.send("q".to_string()).await.is_ok() {
            debug!("Sent q to ffmpeg stdin");
            ffmpeg_task.status = FfmpegTaskStatus::Cancelled;
        }
    }
}

fn handle_ffmpeg_progress(p: FfmpegProgress, ffmpeg_task: &Arc<RwLock<FfmpegTask>>, total_duration: f64) {
    let ffmpeg_task_clone = ffmpeg_task.clone();
    debug!("FFmpeg progress event: {:?}", p);
    tokio::spawn(async move {
        let mut ffmpeg_task = ffmpeg_task_clone.write().await;

        // A late event must not revive a finished or cancelled task (the queue would wait for it forever)
        // or reset the taskbar progress of the task that runs next
        if !matches!(ffmpeg_task.status, FfmpegTaskStatus::InProgress { .. }) {
            return;
        }

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
