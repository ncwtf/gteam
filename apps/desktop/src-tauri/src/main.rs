// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git_watcher;
mod keyring_store;

use tauri::Manager;
use std::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(git_watcher::GitWatcher::new()))
        .invoke_handler(tauri::generate_handler![
            git_watcher::start_watching_repo,
            git_watcher::stop_watching_repo,
            git_watcher::get_current_git_status,
            keyring_store::store_team_token,
            keyring_store::get_team_token,
            keyring_store::delete_team_token,
            keyring_store::list_stored_teams,
        ])
        .setup(|app| {
            // 设置系统托盘
            #[cfg(desktop)]
            {
                use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState};
                use tauri::image::Image;
                
                // 使用 template 图标（macOS 推荐），其他平台使用黑色图标
                #[cfg(target_os = "macos")]
                let tray_icon = {
                    let icon_bytes = include_bytes!("../icons/tray-black-32.png");
                    Image::from_bytes(icon_bytes).expect("Failed to load tray icon")
                };
                
                #[cfg(not(target_os = "macos"))]
                let tray_icon = {
                    let icon_bytes = include_bytes!("../icons/tray-white-32.png");
                    Image::from_bytes(icon_bytes).expect("Failed to load tray icon")
                };
                
                let mut tray_builder = TrayIconBuilder::new()
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
                
                // macOS 使用 template 模式
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
