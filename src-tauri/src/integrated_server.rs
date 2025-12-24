use tower::{ServiceBuilder, ServiceExt};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use axum::Router;
use tauri::AppHandle;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use axum::body::Body;
use axum::http::{HeaderValue, Method, Request};
use axum::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, RANGE, CONTENT_TYPE};
use axum::routing::get;
use log::{debug, info};
use tokio::sync::RwLock;
use tower_http::{
    services::ServeFile,
    trace::TraceLayer,
    cors::{CorsLayer, Any},
};

const FILES_HOST_SERVER_PORT: u16 = 38125;


#[derive(Clone, Debug)]
pub struct IntegratedServerState {
    pub allowed_files: Arc<RwLock<HashSet<PathBuf>>>,
}

impl IntegratedServerState {
    pub fn new() -> Self {
        Self {
            allowed_files: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    pub async fn allow_file(&self, path: impl AsRef<std::path::Path>) {
        let mut allowed_files = self.allowed_files.write().await;
        let path_buf: PathBuf = path.as_ref().components().collect();
        allowed_files.insert(path_buf);
    }
}

pub async fn start_integrated_server(
    app_handle: AppHandle,
    state: IntegratedServerState
) {
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:1420".parse::<HeaderValue>().unwrap(),
            "http://tauri.localhost".parse::<HeaderValue>().unwrap()
        ])
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/{path}", get(serve_video))
        .with_state(state)
        .layer(ServiceBuilder::new().layer(cors));

    let addr = SocketAddr::from(([127, 0, 0, 1], FILES_HOST_SERVER_PORT));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    info!("Integrated server listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app.layer(TraceLayer::new_for_http()))
        .await
        .unwrap();
}

pub async fn serve_video(
    Path(path): Path<String>,
    State(state): State<IntegratedServerState>,
    req: Request<Body>,
) -> impl IntoResponse {
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