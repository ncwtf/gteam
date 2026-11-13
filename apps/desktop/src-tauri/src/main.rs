// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git_watcher;
mod keyring_store;
mod mcp_runtime;
mod mcp_sidecar_path;

use std::sync::Mutex;
use tauri::Emitter;
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
        .manage(Mutex::new(git_watcher::GitWatcher::new()))
        .invoke_handler(tauri::generate_handler![
            git_watcher::start_watching_repo,
            git_watcher::stop_watching_repo,
            git_watcher::get_current_git_status,
            keyring_store::store_team_token,
            keyring_store::get_team_token,
            keyring_store::delete_team_token,
            keyring_store::list_stored_teams,
            mcp_runtime::mcp_server_path,
            mcp_runtime::paths_exist,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(desktop)]
fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let check_update = MenuItem::with_id(app, "check-update", "检查更新", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &check_update, &separator, &quit])?;

    // The monochrome template glyph disappears on light taskbars and, on Linux,
    // the status icon is not shown at all until a menu is attached.
    let tray_icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .expect("failed to load the app icon");

    let tray = TrayIconBuilder::with_id("gteam")
        .icon(tray_icon)
        .tooltip("gteam")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => reveal_main(app),
            "check-update" => {
                reveal_main(app);
                let _ = app.emit("gteam-check-update", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let activate = matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            );
            if activate {
                reveal_main(tray.app_handle());
            }
        })
        .build(app)?;

    // Keep the handle alive. Dropping it removes the icon on some platforms.
    std::mem::forget(tray);
    Ok(())
}

#[cfg(desktop)]
fn reveal_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
