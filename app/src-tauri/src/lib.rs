use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// Called from the frontend after querying due count.
/// Rebuilds the tray menu with the updated label.
#[tauri::command]
fn update_tray_due_count(app: tauri::AppHandle, count: u32) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    let label = if count == 0 {
        "No reviews due".to_string()
    } else {
        format!("Due Today: {count}")
    };
    if let (Ok(open), Ok(due), Ok(quit)) = (
        MenuItem::with_id(&app, "open", "Open QualDeck", true, None::<&str>),
        MenuItem::with_id(&app, "due", label, false, None::<&str>),
        MenuItem::with_id(&app, "quit", "Quit", true, None::<&str>),
    ) {
        if let Ok(new_menu) = Menu::with_items(&app, &[&open, &due, &quit]) {
            let _ = tray.set_menu(Some(new_menu));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:mathdeck.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "init",
                            sql: include_str!("../migrations/01-init.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "composite-pid",
                            sql: include_str!("../migrations/02-composite-pid.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "problems-library-id",
                            sql: include_str!("../migrations/03-problems-library-id.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 4,
                            description: "exam-sessions-lists",
                            sql: include_str!("../migrations/04-exam-sessions-lists.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 5,
                            description: "problem-notes",
                            sql: include_str!("../migrations/05-problem-notes.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 6,
                            description: "performance-indexes",
                            sql: include_str!("../migrations/06-performance-indexes.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let open_item =
                MenuItem::with_id(app, "open", "Open QualDeck", true, None::<&str>)?;
            let due_item =
                MenuItem::with_id(app, "due", "Loading...", false, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &due_item, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(tauri::include_image!("icons/32x32.png"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Minimize to tray instead of closing
            let main_window = app.get_webview_window("main").unwrap();
            let win = main_window.clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = win.hide();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![update_tray_due_count])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
