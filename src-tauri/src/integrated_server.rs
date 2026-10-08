use crate::APP_IDENTIFIER;
use axum::Router;
use axum::body::Body;
use axum::http::{HeaderValue, Request, header};
use axum::middleware::{self, Next};
use axum::routing::get;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
    pub token: Arc<str>,
}

impl IntegratedServerState {
    pub fn new() -> Self {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).expect("Failed to generate integrated server token");

        Self {
            allowed_files: Arc::new(RwLock::new(HashSet::new())),
            port: Arc::new(RwLock::new(None)),
            token: URL_SAFE_NO_PAD.encode(bytes).into(),
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
    token: String,
}

pub async fn start_integrated_server(app_handle: AppHandle, state: IntegratedServerState) {
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:1420".parse::<HeaderValue>().unwrap(),
            "http://tauri.localhost".parse::<HeaderValue>().unwrap(),
            "tauri://localhost".parse::<HeaderValue>().unwrap(),
        ])
        .allow_methods(Any)
        .allow_headers(Any);

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

    let app = Router::new()
        .route("/{token}/{path}", get(serve_video))
        .with_state(state.clone())
        .layer(ServiceBuilder::new().layer(cors).layer(middleware::from_fn_with_state(port, check_host)));

    let token = state.token.to_string();
    app_handle.emit("integrated-server-started", IntegratedServerStarted { port, token }).unwrap();
    state.port.write().await.replace(port);

    // Default span records the full URI, which would leak the token into logs
    let trace = TraceLayer::new_for_http().make_span_with(|req: &Request<Body>| {
        let path = req.uri().path().splitn(3, '/').nth(2).unwrap_or_default();
        tracing::debug_span!("request", method = %req.method(), path)
    });

    axum::serve(listener, app.layer(trace)).await.unwrap();
}

// Guards against DNS rebinding: a rebound page sends its own domain in Host.
async fn check_host(State(port): State<u16>, req: Request<Body>, next: Next) -> Response {
    let host_allowed = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"));

    if !host_allowed {
        return StatusCode::FORBIDDEN.into_response();
    }

    next.run(req).await
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub async fn serve_video(
    Path((token, path)): Path<(String, String)>,
    State(state): State<IntegratedServerState>,
    req: Request<Body>,
) -> impl IntoResponse {
    if !constant_time_eq(token.as_bytes(), state.token.as_bytes()) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let files = state.allowed_files.read().await;
    let path_buf: PathBuf = PathBuf::from(path).components().collect();

    let path = match files.contains(&path_buf) {
        true => path_buf,
        false => {
            let temp_dir = std::env::temp_dir().join(APP_IDENTIFIER);
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
    let state = app_handle.state::<IntegratedServerState>();
    let port = *state.port.read().await;

    port.map(|port| IntegratedServerStarted { port, token: state.token.to_string() })
}
