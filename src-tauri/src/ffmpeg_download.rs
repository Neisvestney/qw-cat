use anyhow::Result;
use ffmpeg_sidecar::command::ffmpeg_is_installed;
use ffmpeg_sidecar::download::{ffmpeg_download_url, unpack_ffmpeg};
use ffmpeg_sidecar::paths::sidecar_dir;
use log::debug;
use std::path::{Path, PathBuf};

pub fn download_with_progress(progress_callback: impl Fn(f64)) -> Result<()> {
    progress_callback(0.0);
    let download_url = ffmpeg_download_url()?;
    let destination = sidecar_dir()?;
    let archive_path = download_ffmpeg_package_with_progress(download_url, &destination, |(total, downloaded)| {
        progress_callback(downloaded as f64 / total as f64)
    })?;
    progress_callback(0.0);
    unpack_ffmpeg(&archive_path, &destination)?;
    progress_callback(1.0);

    if !ffmpeg_is_installed() {
        anyhow::bail!("FFmpeg failed to install, please install manually.");
    }

    Ok(())
}

pub fn download_ffmpeg_package_with_progress(url: &str, download_dir: &Path, progress_callback: impl Fn((u64, u64))) -> Result<PathBuf> {
    use anyhow::Context;
    use std::{
        fs::File,
        io::{Read, copy},
        path::Path,
    };

    let filename = Path::new(url).file_name().context("Failed to get filename")?;

    let archive_path = download_dir.join(filename);

    let mut response = ureq::get(url).call().context("Failed to download ffmpeg")?;

    let total_size = response
        .headers()
        .get("Content-Length")
        .and_then(|s| s.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let mut file = File::create(&archive_path).context("Failed to create file for ffmpeg download")?;

    // Wrapper to track progress during io::copy
    struct ProgressReader<R, F> {
        inner: R,
        progress_callback: F,
        downloaded: u64,
        total: u64,
        counter: u64,
    }

    impl<R: Read, F: Fn((u64, u64))> Read for ProgressReader<R, F> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let n = self.inner.read(buf)?;
            self.downloaded += n as u64;
            self.counter += 1;

            if self.counter.is_multiple_of(1000) {
                (self.progress_callback)((self.total, self.downloaded));
                debug!("FFmpeg downloading... {}Mb/{}Mb", self.downloaded / 1024 / 1024, self.total / 1024 / 1024);
            }

            Ok(n)
        }
    }

    let mut progress_reader = ProgressReader {
        inner: response.body_mut().as_reader(),
        progress_callback,
        downloaded: 0,
        total: total_size,
        counter: 0,
    };

    copy(&mut progress_reader, &mut file).context("Failed to write ffmpeg download to file")?;

    Ok(archive_path)
}
