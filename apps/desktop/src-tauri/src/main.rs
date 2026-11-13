// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git_monitor;
mod git_watcher;
mod keyring_store;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(git_watcher::GitWatcher::new())
        .invoke_handler(tauri::generate_handler![
            git_watcher::list_git_monitors,
            git_watcher::inspect_git_source,
            git_watcher::add_git_monitor,
            git_watcher::update_git_monitor,
            git_watcher::remove_git_monitor,
            git_watcher::pending_git_progress,
            git_watcher::ack_git_progress,
            git_watcher::set_git_sync_error,
            keyring_store::store_team_token,
            keyring_store::get_team_token,
            keyring_store::delete_team_token,
            keyring_store::list_stored_teams,
        ])
        .setup(|app| {
            git_watcher::restore(app.handle())?;
            #[cfg(desktop)]
            {
                use tauri::image::Image;
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};

                // macOS menu bar uses a template image (black pixels + alpha).
                // Other platforms use the white glyph on a dark tray.
                #[cfg(target_os = "macos")]
                let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-black-32.png"))
                    .expect("Failed to load tray icon");
                #[cfg(not(target_os = "macos"))]
                let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-white-32.png"))
                    .expect("Failed to load tray icon");

                let mut tray_builder =
                    TrayIconBuilder::new()
                        .icon(tray_icon)
                        .on_tray_icon_event(|tray, event| {
                            if let tauri::tray::TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } = event
                            {
                                let app = tray.app_handle();
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        });

                #[cfg(target_os = "macos")]
                {
                    tray_builder = tray_builder.icon_as_template(true);
                }

                let _tray = tray_builder.build(app)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
