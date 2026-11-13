use std::path::{Path, PathBuf};
use tauri::Manager;

/// Absolute path of the MCP sidecar shipped inside the app bundle.
/// IDEs launch this binary themselves, so the path has to be absolute and
/// must not point at a development checkout.
#[tauri::command]
pub fn mcp_server_path(app: tauri::AppHandle) -> Result<String, String> {
    mcp_sidecar_path(&app).map(|path| path.to_string_lossy().to_string())
}

/// Existence check that is not limited to the webview filesystem scope.
/// Program Files, /usr/bin and the app bundle sit outside $HOME.
#[tauri::command]
pub fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths
        .into_iter()
        .map(|path| Path::new(&path).is_file())
        .collect()
}

fn mcp_sidecar_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let file_name = sidecar_file_name();
    let mut candidates = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(&file_name));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(&file_name));
        if let Some(parent) = resource_dir.parent() {
            candidates.push(parent.join(&file_name));
            candidates.push(parent.join("MacOS").join(&file_name));
        }
    }
    candidates.push(PathBuf::from("/usr/bin").join(&file_name));

    for path in &candidates {
        if path.is_file() {
            return Ok(path.clone());
        }
    }
    Err(format!(
        "未找到随应用安装的 MCP 程序（{}）",
        file_name
    ))
}

fn sidecar_file_name() -> String {
    let triple = env!("GTEAM_TARGET_TRIPLE");
    if cfg!(windows) {
        format!("gteam-mcp-{triple}.exe")
    } else {
        format!("gteam-mcp-{triple}")
    }
}
