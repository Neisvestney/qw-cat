use crate::ffmpeg_settings::{FfmpegSource, current_ffmpeg_settings};
use crate::ffprobe::BackgroundCommand;
use anyhow::Context;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn ffmpeg_path() -> PathBuf {
    let settings = current_ffmpeg_settings();
    binary_path("ffmpeg", settings.source, settings.custom_dir.as_deref())
}

pub fn ffprobe_path() -> PathBuf {
    let settings = current_ffmpeg_settings();
    binary_path("ffprobe", settings.source, settings.custom_dir.as_deref())
}

fn executable_name(name: &str) -> PathBuf {
    let mut path = PathBuf::from(name);
    if cfg!(windows) {
        path.set_extension("exe");
    }
    path
}

fn binary_path(name: &str, source: Option<FfmpegSource>, custom_dir: Option<&str>) -> PathBuf {
    let system = PathBuf::from(name);
    let downloaded = sidecar_dir().map(|dir| dir.join(executable_name(name)));

    match source {
        Some(FfmpegSource::Downloaded) => downloaded.unwrap_or(system),
        Some(FfmpegSource::System) => system,
        Some(FfmpegSource::Custom) => match custom_dir {
            Some(dir) => Path::new(dir).join(executable_name(name)),
            None => system,
        },
        // Not chosen yet: whatever is there
        None => match downloaded {
            Ok(path) if path.exists() => path,
            _ => system,
        },
    }
}

#[cfg(windows)]
const APP_DIRECTORY: &str = "Qw Cat";

#[cfg(not(windows))]
const APP_DIRECTORY: &str = "io.github.neisvestney.qw-cat";

pub fn sidecar_dir() -> anyhow::Result<PathBuf> {
    Ok(dirs::data_local_dir().context("Can't get data_local_dir")?.join(APP_DIRECTORY))
}

fn runs(path: &Path) -> bool {
    Command::new(path)
        .arg("-version")
        .create_no_window()
        .stderr(Stdio::null())
        .stdout(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or_else(|_| false)
}

pub fn source_is_available(source: FfmpegSource, custom_dir: Option<&str>) -> bool {
    runs(&binary_path("ffmpeg", Some(source), custom_dir)) && runs(&binary_path("ffprobe", Some(source), custom_dir))
}

pub fn ffmpeg_is_installed() -> bool {
    runs(&ffmpeg_path())
}

pub fn ffprobe_is_installed() -> bool {
    runs(&ffprobe_path())
}
