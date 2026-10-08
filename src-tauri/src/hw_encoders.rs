use crate::ffmpeg_path::{ffmpeg_is_installed, ffmpeg_path};
use crate::ffprobe::BackgroundCommand;
use log::{error, info};
use serde::Serialize;
use std::process::{Command, Stdio};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HwEncoders {
    pub encoders: Vec<String>,
    pub ffmpeg_installed: bool,
}

// Grouped by vendor: vendors are probed in parallel, encoders of one vendor one by one to stay under NVENC session limits.
// The last group holds CPU encoders that some ffmpeg builds leave out
const HW_ENCODERS: [&[&str]; 4] = [
    &["h264_nvenc", "hevc_nvenc", "av1_nvenc"],
    &["h264_amf", "hevc_amf", "av1_amf"],
    &["h264_qsv", "hevc_qsv", "av1_qsv", "vp9_qsv"],
    &["libsvtav1", "libwebp_anim"],
];

// The bundled ffmpeg lists every hardware encoder in `-encoders`, so only a real encode proves the GPU and driver work
fn probe_encoder(encoder: &str) -> bool {
    #[rustfmt::skip]
    let status = Command::new(ffmpeg_path())
        .create_no_window()
        .args([
            "-hide_banner", "-v", "error",
            "-f", "lavfi", "-i", "color=black:s=256x256:r=30",
            "-frames:v", "3",
            "-c:v", encoder,
            "-f", "null", "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    status.map(|s| s.success()).unwrap_or(false)
}

fn probe_all() -> HwEncoders {
    if !ffmpeg_is_installed() {
        return HwEncoders {
            encoders: vec![],
            ffmpeg_installed: false,
        };
    }

    let probes: Vec<_> = HW_ENCODERS
        .iter()
        .copied()
        .map(|encoders| {
            (
                encoders,
                std::thread::spawn(move || {
                    encoders
                        .iter()
                        .copied()
                        .filter(|encoder| probe_encoder(encoder))
                        .map(String::from)
                        .collect::<Vec<_>>()
                }),
            )
        })
        .collect();

    let encoders = probes
        .into_iter()
        .flat_map(|(group, probe)| {
            probe.join().unwrap_or_else(|_| {
                error!("Hardware encoder probe panicked for {:?}", group);
                vec![]
            })
        })
        .collect();

    HwEncoders {
        encoders,
        ffmpeg_installed: true,
    }
}

#[tauri::command]
pub async fn detect_hw_encoders() -> HwEncoders {
    let detected = tokio::task::spawn_blocking(probe_all).await.unwrap_or_else(|e| {
        error!("Hardware encoder detection failed: {e}");
        HwEncoders {
            encoders: vec![],
            ffmpeg_installed: false,
        }
    });

    info!("Detected hardware encoders: {:?}", detected.encoders);
    detected
}
