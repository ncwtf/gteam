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
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        .on_window_event(|window, event| {
            // 关闭主窗口时隐藏到托盘，通过托盘菜单「退出」真正退出
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::image::Image;
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri::Emitter;

                // macOS 菜单栏使用模板图（黑色 + 透明）；Windows / Linux 使用应用图标，
                // 浅色和深色任务栏都能看清。
                #[cfg(target_os = "macos")]
                let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-black-32.png"))?;
                #[cfg(not(target_os = "macos"))]
                let tray_icon = match app.default_window_icon() {
                    Some(icon) => icon.clone().to_owned(),
                    None => Image::from_bytes(include_bytes!("../icons/32x32.png"))?,
                };

                let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                let update_item = MenuItem::with_id(app, "check_update", "检查更新", true, None::<&str>)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &update_item, &separator, &quit_item])?;

                let mut tray_builder = TrayIconBuilder::with_id("main")
                    .icon(tray_icon)
                    .tooltip("gteam")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => show_main_window(app),
                        "check_update" => {
                            show_main_window(app);
                            let _ = app.emit("tray-check-update", ());
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
                            show_main_window(tray.app_handle());
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS：点击 Dock 图标时重新显示被隐藏的主窗口
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_main_window(_app);
            }
        });
}

#[cfg(desktop)]
fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
