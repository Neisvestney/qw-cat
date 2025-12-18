use tauri::WindowEvent;

pub fn handle_main_window_event(event: &WindowEvent) {
    match event {
        WindowEvent::DragDrop(drag_drop_event) => {}
        _ => {}
    }
}
