use std::path::{Path, PathBuf};
use tauri::Manager;

/// Absolute path of the MCP sidecar shipped inside the app bundle.
/// IDEs launch this binary themselves, so the path has to be absolute and
/// must not point at a development checkout.
#[tauri::command]
pub fn mcp_server_path(app: tauri::AppHandle) -> Result<String, String> {
    mcp_sidecar_path_for(&app).map(|path| path.to_string_lossy().to_string())
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

fn current_executable() -> Option<PathBuf> {
    // Same executable path the shell plugin uses for `sidecar()`, including
    // canonicalization. Fall back to the raw path if that lookup fails.
    tauri::utils::platform::current_exe()
        .ok()
        .or_else(|| std::env::current_exe().ok())
}

fn mcp_sidecar_path_for(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let triple = env!("GTEAM_TARGET_TRIPLE");
    let windows = cfg!(windows);
    let exe = current_executable();
    let resource = app.path().resource_dir().ok();
    let candidates = crate::mcp_sidecar_path::candidate_paths(
        exe.as_deref(),
        resource.as_deref(),
        triple,
        windows,
    );
    crate::mcp_sidecar_path::first_existing(&candidates)
        .ok_or_else(|| crate::mcp_sidecar_path::missing_message(triple, windows))
}
