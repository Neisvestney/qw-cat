use tauri::AppHandle;
use tauri::Manager;

#[tauri::command]
pub async fn open_devtools(app_handle: AppHandle) {
    let main_window = app_handle.get_webview_window("main").unwrap();
    main_window.open_devtools();
}
