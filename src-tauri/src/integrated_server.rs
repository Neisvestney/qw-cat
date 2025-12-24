use crate::ffmpeg::{FfmpegTaskStatus, FfmpegTaskType, FfmpegTasksQueue};
use axum::body::Body;
use axum::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use axum::http::{HeaderValue, Method, Request};
use axum::routing::get;
use axum::Router;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;
use tower::{ServiceBuilder, ServiceExt};
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeFile,
    trace::TraceLayer,
};

pub const INTEGRATED_SERVER_PORT_RANGE: std::ops::RangeInclusive<u16> = 38125..=39125;

#[derive(Clone, Debug)]
pub struct IntegratedServerState {
    pub allowed_files: Arc<RwLock<HashSet<PathBuf>>>,
    pub port: Arc<RwLock<Option<u16>>>,
}

impl IntegratedServerState {
    pub fn new() -> Self {
        Self {
            allowed_files: Arc::new(RwLock::new(HashSet::new())),
            port: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn allow_file(&self, path: impl AsRef<std::path::Path>) {
        let mut allowed_files = self.allowed_files.write().await;
        let path_buf: PathBuf = path.as_ref().components().collect();
        allowed_files.insert(path_buf);
    }
}

#[derive(Debug, Serialize, Deserialize, ts_rs::TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IntegratedServerStarted {
    port: u16,
}

pub async fn start_integrated_server(app_handle: AppHandle, state: IntegratedServerState) {
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:1420".parse::<HeaderValue>().unwrap(),
            "http://tauri.localhost".parse::<HeaderValue>().unwrap(),
        ])
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/{path}", get(serve_video))
        .with_state(state.clone())
        .layer(ServiceBuilder::new().layer(cors));

    let mut listener = None;
    let mut last_error = None;

    for port in INTEGRATED_SERVER_PORT_RANGE {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(e) => {
                debug!("Failed to bind to port {}: {}", port, e);
                last_error = Some(e);
            }
        }
    }

    if listener.is_none() {
        debug!("Failed to bind to any port in range, trying port 0");
        let addr = SocketAddr::from(([127, 0, 0, 1], 0));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => {
                listener = Some(l);
            }
            Err(e) => {
                debug!("Failed to bind to port 0: {}", e);
                last_error = Some(e);
            }
        }
    }

    let listener = listener.unwrap_or_else(|| {
        panic!("Failed to bind to any port in range: {:?}", last_error);
    });

    info!("Integrated server listening on {}", listener.local_addr().unwrap());

    let port = listener.local_addr().unwrap().port();
    app_handle.emit("integrated-server-started", IntegratedServerStarted { port }).unwrap();
    state.port.write().await.replace(port);

    axum::serve(listener, app.layer(TraceLayer::new_for_http())).await.unwrap();
}

pub async fn serve_video(Path(path): Path<String>, State(state): State<IntegratedServerState>, req: Request<Body>) -> impl IntoResponse {
    let files = state.allowed_files.read().await;
    let path_buf: PathBuf = PathBuf::from(path).components().collect();

    let path = match files.contains(&path_buf) {
        true => path_buf,
        false => {
            let temp_dir = std::env::temp_dir().join("qw-cat");
            let canonical_temp = match temp_dir.canonicalize() {
                Ok(p) => p,
                Err(_) => return StatusCode::NOT_FOUND.into_response(),
            };

            let canonical_path = match path_buf.canonicalize() {
                Ok(p) => p,
                Err(_) => return StatusCode::NOT_FOUND.into_response(),
            };

            if !canonical_path.starts_with(&canonical_temp) {
                return StatusCode::NOT_FOUND.into_response();
            }

            canonical_path
        }
    };

    let svc = ServeFile::new(path);

    match svc.oneshot(req).await {
        Ok(res) => res.into_response(),
        Err(_err) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[tauri::command]
pub async fn get_integrated_server_state(app_handle: AppHandle) -> Option<IntegratedServerStarted> {
    let port = *app_handle.state::<IntegratedServerState>().port.read().await;

    port.map(|port| IntegratedServerStarted { port })
}
