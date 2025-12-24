use crate::APP_HANDLE;
use log::Record;
use ringbuf::traits::{Consumer, RingBuffer};
use ringbuf::HeapRb;
use serde::Serialize;
use serde_repr::Serialize_repr;
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Clone)]
pub struct LogRecord {
    message: String,
    level: LogLevel,
}

#[derive(Debug, Clone, Serialize_repr)]
#[repr(u16)]
pub enum LogLevel {
    Trace = 1,
    Debug,
    Info,
    Warn,
    Error,
}

impl From<log::Level> for LogLevel {
    fn from(log_level: log::Level) -> Self {
        match log_level {
            log::Level::Trace => LogLevel::Trace,
            log::Level::Debug => LogLevel::Debug,
            log::Level::Info => LogLevel::Info,
            log::Level::Warn => LogLevel::Warn,
            log::Level::Error => LogLevel::Error,
        }
    }
}

impl From<&Record<'_>> for LogRecord {
    fn from(value: &Record) -> Self {
        LogRecord {
            message: value.args().to_string(),
            level: value.level().into(),
        }
    }
}

pub struct LogsStore {
    buf: RwLock<HeapRb<LogRecord>>,
}

impl LogsStore {
    pub fn new() -> Self {
        Self {
            buf: RwLock::new(HeapRb::new(1000)),
        }
    }
}

pub fn get_logs_store_target() -> tauri_plugin_log::TargetKind {
    tauri_plugin_log::TargetKind::Dispatch(fern::Dispatch::new().chain(fern::Output::call(|record| {
        let logs_store = APP_HANDLE.get().unwrap().state::<LogsStore>();
        logs_store.buf.write().unwrap().push_overwrite(record.into());
    })))
}

#[tauri::command]
pub async fn get_logs(app_handle: AppHandle) -> Vec<LogRecord> {
    app_handle.state::<LogsStore>().buf.read().unwrap().iter().cloned().collect()
}
