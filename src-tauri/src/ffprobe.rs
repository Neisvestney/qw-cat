use ffmpeg_sidecar::ffprobe::{ffprobe_is_installed, ffprobe_path};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub index: i32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FfprobeFormat {
    duration: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FfprobeOutput {
    streams: Vec<StreamInfo>,
    format: FfprobeFormat,
}

#[derive(Serialize, Deserialize, TS)]
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
    let ffprobe_data: FfprobeOutput = serde_json::from_str(output)?;
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

    let output = std::process::Command::new(ffprobe_path)
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
