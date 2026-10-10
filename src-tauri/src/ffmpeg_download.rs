use crate::ffmpeg_path::{sidecar_dir, source_is_available};
use crate::ffmpeg_settings::FfmpegSource;
use anyhow::{Context, Result};
use log::{debug, info};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use std::time::Duration;

struct PinnedArchive {
    url: &'static str,
    sha256: &'static str,
    /// (path inside archive, destination file name)
    binaries: &'static [(&'static str, &'static str)],
}

// When bumping versions, take SHA-256 from the publisher (gyan.dev / martin-riedl .sha256) and verify locally.
#[cfg(target_os = "windows")]
const ARCHIVES: &[PinnedArchive] = &[PinnedArchive {
    url: "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip",
    sha256: "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba",
    binaries: &[
        ("ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe", "ffmpeg.exe"),
        ("ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe", "ffprobe.exe"),
    ],
}];

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const ARCHIVES: &[PinnedArchive] = &[
    PinnedArchive {
        url: "https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffmpeg.zip",
        sha256: "fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f",
        binaries: &[("ffmpeg", "ffmpeg")],
    },
    PinnedArchive {
        url: "https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffprobe.zip",
        sha256: "3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32",
        binaries: &[("ffprobe", "ffprobe")],
    },
];

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const ARCHIVES: &[PinnedArchive] = &[
    PinnedArchive {
        url: "https://ffmpeg.martin-riedl.de/download/linux/arm64/1789931697_9.0.2/ffmpeg.zip",
        sha256: "93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b",
        binaries: &[("ffmpeg", "ffmpeg")],
    },
    PinnedArchive {
        url: "https://ffmpeg.martin-riedl.de/download/linux/arm64/1789931697_9.0.2/ffprobe.zip",
        sha256: "bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330",
        binaries: &[("ffprobe", "ffprobe")],
    },
];

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const ARCHIVES: &[PinnedArchive] = &[
    PinnedArchive {
        url: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip",
        sha256: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4",
        binaries: &[("ffmpeg", "ffmpeg")],
    },
    PinnedArchive {
        url: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffprobe.zip",
        sha256: "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd",
        binaries: &[("ffprobe", "ffprobe")],
    },
];

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const ARCHIVES: &[PinnedArchive] = &[
    PinnedArchive {
        url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip",
        sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
        binaries: &[("ffmpeg", "ffmpeg")],
    },
    PinnedArchive {
        url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffprobe.zip",
        sha256: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
        binaries: &[("ffprobe", "ffprobe")],
    },
];

#[cfg(not(any(
    target_os = "windows",
    all(target_os = "linux", any(target_arch = "x86_64", target_arch = "aarch64")),
    all(target_os = "macos", any(target_arch = "x86_64", target_arch = "aarch64")),
)))]
const ARCHIVES: &[PinnedArchive] = &[];

const DOWNLOAD_PREFIX: &str = ".ffmpeg-download-";

/// Leftovers from a download interrupted by the app being killed.
fn remove_stale_downloads(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(DOWNLOAD_PREFIX) {
            info!("Removing stale ffmpeg download {:?}", entry.path());
            let _ = fs::remove_file(entry.path());
        }
    }
}

pub fn download_with_progress(progress_callback: impl Fn(f64)) -> Result<()> {
    if ARCHIVES.is_empty() {
        anyhow::bail!("Automatic FFmpeg download is not supported on this platform, please install manually.");
    }

    progress_callback(0.0);
    let destination = sidecar_dir()?;
    info!("{:?}", destination);
    fs::create_dir_all(&destination).context("Failed to create directory for ffmpeg download")?;
    remove_stale_downloads(&destination);

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        // ureq has no idle-read timeout, so cap the whole body instead
        .timeout_recv_body(Some(Duration::from_secs(60 * 60)))
        .build()
        .into();

    let archives_count = ARCHIVES.len() as f64;
    for (index, archive) in ARCHIVES.iter().enumerate() {
        let archive_path = destination.join(format!("{DOWNLOAD_PREFIX}{:016x}.zip", getrandom::u64().map_err(anyhow::Error::msg)?));
        let result = download_verified(&agent, archive, &archive_path, |(total, downloaded)| {
            if total > 0 {
                progress_callback((index as f64 + downloaded as f64 / total as f64) / archives_count)
            }
        })
        .and_then(|file| extract_binaries(file, archive.binaries, &destination));
        let _ = fs::remove_file(&archive_path);
        result?;
    }
    progress_callback(1.0);

    if !source_is_available(FfmpegSource::Downloaded, None) {
        anyhow::bail!("FFmpeg failed to install, please install manually.");
    }

    Ok(())
}

/// Hashes while downloading and returns the same open handle, so the verified bytes are what gets extracted.
fn download_verified(agent: &ureq::Agent, archive: &PinnedArchive, archive_path: &Path, progress_callback: impl Fn((u64, u64))) -> Result<File> {
    let mut response = agent.get(archive.url).call().context("Failed to download ffmpeg")?;

    let total_size = response
        .headers()
        .get("Content-Length")
        .and_then(|s| s.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    info!("{} -> {:?}", archive.url, archive_path);
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(archive_path)
        .context("Failed to create file for ffmpeg download")?;

    // Wrapper to track progress and hash during io::copy
    struct ProgressReader<R, F> {
        inner: R,
        progress_callback: F,
        hasher: Sha256,
        downloaded: u64,
        total: u64,
        counter: u64,
    }

    impl<R: Read, F: Fn((u64, u64))> Read for ProgressReader<R, F> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let n = self.inner.read(buf)?;
            self.hasher.update(&buf[..n]);
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
        hasher: Sha256::new(),
        downloaded: 0,
        total: total_size,
        counter: 0,
    };

    io::copy(&mut progress_reader, &mut file).context("Failed to write ffmpeg download to file")?;

    let actual = format!("{:x}", progress_reader.hasher.finalize());
    if actual != archive.sha256 {
        anyhow::bail!(
            "FFmpeg download checksum mismatch for {}: expected {}, got {actual}",
            archive.url,
            archive.sha256
        );
    }

    file.seek(SeekFrom::Start(0))?;
    Ok(file)
}

fn extract_binaries(archive_file: File, binaries: &[(&str, &str)], destination: &Path) -> Result<()> {
    let mut archive = zip::ZipArchive::new(archive_file).context("Failed to read ffmpeg archive")?;

    for (entry_name, file_name) in binaries {
        let mut entry = archive
            .by_name(entry_name)
            .with_context(|| format!("{entry_name} not found in ffmpeg archive"))?;
        let target = destination.join(file_name);
        let partial = destination.join(format!("{file_name}.part"));

        let result = (|| {
            let mut file = File::create(&partial).with_context(|| format!("Failed to create {:?}", partial))?;
            io::copy(&mut entry, &mut file).with_context(|| format!("Failed to extract {entry_name}"))?;
            file.sync_all()?;
            drop(file);

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&partial, fs::Permissions::from_mode(0o755))?;
            }

            fs::rename(&partial, &target).with_context(|| format!("Failed to move {:?} to {:?}", partial, target))
        })();

        if result.is_err() {
            let _ = fs::remove_file(&partial);
        }
        result?;
    }

    Ok(())
}
