use crate::ffmpeg_path::{ffprobe_is_installed, ffprobe_path};
use log::info;
use serde::{Deserialize, Serialize};
use std::process::Command;
use ts_rs::TS;

pub(crate) trait BackgroundCommand {
    fn create_no_window(&mut self) -> &mut Self;
}

impl BackgroundCommand for Command {
    /// Disable creating a new console window for the spawned process on Windows.
    /// Has no effect on other platforms. This can be useful when spawning a command
    /// from a GUI program.
    fn create_no_window(&mut self) -> &mut Self {
        #[cfg(target_os = "windows")]
        std::os::windows::process::CommandExt::creation_flags(self, 0x08000000);
        self
    }
}

#[derive(Clone, Serialize, Deserialize, TS)]
pub struct StreamInfo {
    pub index: i32,
    pub codec_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfprobeFormat {
    pub duration: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfprobeOutput {
    pub streams: Vec<StreamInfo>,
    pub format: FfprobeFormat,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct VideoAudioStreamsInfo {
    pub audio_streams: Vec<StreamInfo>,
    pub duration: f64,
}

impl VideoAudioStreamsInfo {
    pub fn empty() -> Self {
        Self {
            audio_streams: vec![],
            duration: 0.0,
        }
    }
}

fn parse_ffprobe_output(output: &str) -> Result<VideoAudioStreamsInfo, serde_json::Error> {
    let res = serde_json::from_str(output);
    let ffprobe_data: FfprobeOutput = res?;
    let audio_streams: Vec<StreamInfo> = ffprobe_data.streams.into_iter().collect();

    Ok(VideoAudioStreamsInfo {
        audio_streams,
        duration: ffprobe_data.format.duration.parse::<f64>().unwrap_or(0.0),
    })
}

pub fn get_video_audio_streams_info(path: impl AsRef<str>) -> Option<VideoAudioStreamsInfo> {
    let ffprobe_path = ffprobe_path();

    if !ffprobe_is_installed() {
        return None;
    }

    #[rustfmt::skip]
    let output = std::process::Command::new(ffprobe_path)
        .create_no_window()
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-select_streams", "a",
            "-show_format",
            "-show_streams",
            path.as_ref()
        ])
        .output()
        .ok()?;

    let output_str = String::from_utf8_lossy(&output.stdout);

    parse_ffprobe_output(&output_str).ok()
}

pub fn get_video_streams_info(path: impl AsRef<str>) -> Option<FfprobeOutput> {
    let ffprobe_path = ffprobe_path();

    info!("Using ffprobe: {:?}", ffprobe_path);

    if !ffprobe_is_installed() {
        return None;
    }

    #[rustfmt::skip]
    let output = std::process::Command::new(ffprobe_path)
        .create_no_window()
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-select_streams", "v",
            "-show_format",
            "-show_streams",
            path.as_ref()
        ])
        .output()
        .ok()?;

    let output_str = String::from_utf8_lossy(&output.stdout);

    let ffprobe_data: FfprobeOutput = serde_json::from_str(&output_str).ok()?;

    Some(ffprobe_data)
}
