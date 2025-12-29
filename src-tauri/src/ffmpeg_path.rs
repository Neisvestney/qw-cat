use crate::ffprobe::BackgroundCommand;
use anyhow::Context;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn ffmpeg_path() -> PathBuf {
    let default = Path::new("ffmpeg").to_path_buf();
    match sidecar_path() {
        Ok(sidecar_path) => match sidecar_path.exists() {
            true => sidecar_path,
            false => default,
        },
        Err(_) => default,
    }
}

pub fn ffprobe_path() -> PathBuf {
    let default = Path::new("ffprobe").to_path_buf();
    match sidecar_path() {
        Ok(sidecar_path) => {
            let mut sidecar_path = sidecar_path.parent().map(|p| p.to_owned()).unwrap_or(PathBuf::new()).join("ffprobe");

            if cfg!(windows) {
                sidecar_path.set_extension("exe");
            }

            match sidecar_path.exists() {
                true => sidecar_path,
                false => default,
            }
        }
        Err(_) => default,
    }
}

#[cfg(windows)]
const APP_DIRECTORY: &str = "Qw Cat";

#[cfg(not(windows))]
const APP_DIRECTORY: &str = "io.github.neisvestney.qw-cat";

pub fn sidecar_path() -> anyhow::Result<PathBuf> {
    let mut path = dirs::data_local_dir()
        .context("Can't get data_local_dir")?
        .join(APP_DIRECTORY)
        .join("ffmpeg");
    if cfg!(windows) {
        path.set_extension("exe");
    }
    Ok(path)
}

pub fn sidecar_dir() -> anyhow::Result<PathBuf> {
    Ok(sidecar_path()?.parent().context("invalid sidecar path")?.to_path_buf())
}

pub fn ffmpeg_is_installed() -> bool {
    Command::new(ffmpeg_path())
        .arg("-version")
        .create_no_window()
        .stderr(Stdio::null())
        .stdout(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or_else(|_| false)
}

pub fn ffprobe_is_installed() -> bool {
    Command::new(ffprobe_path())
        .arg("-version")
        .create_no_window()
        .stderr(Stdio::null())
        .stdout(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or_else(|_| false)
}
