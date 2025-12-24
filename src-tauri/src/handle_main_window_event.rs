use tauri::WindowEvent;

#[allow(clippy::single_match)]
pub fn handle_main_window_event(event: &WindowEvent) {
    match event {
        WindowEvent::DragDrop(_drag_drop_event) => {}
        _ => {}
    }
}
