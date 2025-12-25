use crate::APP_HANDLE;
use crate::select_new_video_file_command::select_new_video_file_inner;
use tauri::{DragDropEvent, WindowEvent, async_runtime};
use tauri_plugin_dialog::FilePath;

#[allow(clippy::single_match, clippy::collapsible_match)]
pub fn handle_main_window_event(event: &WindowEvent) {
    match event {
        WindowEvent::DragDrop(drag_drop_event) => match drag_drop_event {
            DragDropEvent::Drop { paths, .. } => {
                if paths.len() == 1 {
                    let app_handle = APP_HANDLE.get().unwrap().clone();
                    let file_path = FilePath::Path(paths.first().unwrap().clone());
                    async_runtime::spawn(select_new_video_file_inner(Some(file_path), app_handle));
                }
            }
            _ => {}
        },
        _ => {}
    }
}
