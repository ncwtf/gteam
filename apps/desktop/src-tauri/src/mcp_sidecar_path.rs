use std::path::{Path, PathBuf};

/// externalBin 在配置里的名字。打包前文件是 `gteam-mcp-<target-triple>`，
/// Tauri bundler 的 `copy_binaries` 会去掉 `-<target>`，安装后的文件名是 `gteam-mcp`。
pub const SIDECAR_STEM: &str = "gteam-mcp";

/// 安装名在前，带 target triple 的开发/未打包文件名在后。
pub fn sidecar_file_names(target_triple: &str, windows: bool) -> [String; 2] {
    let installed = if windows {
        format!("{SIDECAR_STEM}.exe")
    } else {
        SIDECAR_STEM.to_string()
    };
    let with_triple = if windows {
        format!("{SIDECAR_STEM}-{target_triple}.exe")
    } else {
        format!("{SIDECAR_STEM}-{target_triple}")
    };
    [installed, with_triple]
}

/// 与 `tauri_plugin_shell` 2.6.0 的 `relative_command_path` 相同。
/// `Command` 不把解析后的路径暴露出来，IDE 配置只能按同一规则自己算。
///
/// 主程序在 `deps` 目录时（`cargo test`）先向上一级。Windows 补 `.exe`，
/// 其他系统去掉 `.exe`。点号留在文件名里，不用 `set_extension` 去加后缀。
pub fn relative_command_path(current_exe: &Path, command: &Path, windows: bool) -> Option<PathBuf> {
    let exe_dir = current_exe.parent()?;
    let base_dir = if exe_dir.ends_with("deps") {
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    };
    let mut command_path = base_dir.join(command);
    if windows {
        let already_exe = command_path.extension().is_some_and(|ext| ext == "exe");
        if !already_exe {
            command_path.as_mut_os_string().push(".exe");
        }
    } else if command_path.extension().is_some_and(|ext| ext == "exe") {
        command_path.set_extension("");
    }
    Some(command_path)
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn executable_dir(current_exe: &Path) -> Option<&Path> {
    let exe_dir = current_exe.parent()?;
    Some(if exe_dir.ends_with("deps") {
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    })
}

/// 候选路径。第一项是文档里的 sidecar 位置（主程序旁边、不带 triple）。
/// 后面依次是同目录的 triple 文件名、`binaries/`、资源目录、macOS 的 `Contents/MacOS`，以及 `/usr/bin`。
pub fn candidate_paths(
    current_exe: Option<&Path>,
    resource_dir: Option<&Path>,
    target_triple: &str,
    windows: bool,
) -> Vec<PathBuf> {
    let names = sidecar_file_names(target_triple, windows);
    let mut paths = Vec::new();

    if let Some(exe) = current_exe {
        if let Some(path) = relative_command_path(exe, Path::new(SIDECAR_STEM), windows) {
            push_unique(&mut paths, path);
        }
        if let Some(dir) = executable_dir(exe) {
            for name in &names {
                push_unique(&mut paths, dir.join(name));
                push_unique(&mut paths, dir.join("binaries").join(name));
            }
        }
    }

    if let Some(resource_dir) = resource_dir {
        for name in &names {
            push_unique(&mut paths, resource_dir.join(name));
            if let Some(parent) = resource_dir.parent() {
                push_unique(&mut paths, parent.join(name));
                push_unique(&mut paths, parent.join("MacOS").join(name));
            }
        }
    }

    for name in &names {
        push_unique(&mut paths, PathBuf::from("/usr/bin").join(name));
    }
    paths
}

pub fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

pub fn missing_message(target_triple: &str, windows: bool) -> String {
    let names = sidecar_file_names(target_triple, windows);
    format!("未找到随应用安装的 MCP 程序（{}）", names[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_install_prefers_the_unsuffixed_exe_beside_the_app() {
        let exe = Path::new("C:/Program Files/gteam/gteam.exe");
        let resource = Path::new("C:/Program Files/gteam/resources");
        let paths = candidate_paths(Some(exe), Some(resource), "x86_64-pc-windows-msvc", true);
        assert_eq!(
            paths[0],
            PathBuf::from("C:/Program Files/gteam/gteam-mcp.exe")
        );
        assert!(paths
            .iter()
            .any(|path| { path.ends_with("gteam-mcp-x86_64-pc-windows-msvc.exe") }));
        assert!(!paths[0].to_string_lossy().contains("x86_64"));
        assert_eq!(
            missing_message("x86_64-pc-windows-msvc", true),
            "未找到随应用安装的 MCP 程序（gteam-mcp.exe）"
        );
    }

    #[test]
    fn macos_install_is_beside_the_app_in_contents_macos() {
        let exe = Path::new("/Applications/gteam.app/Contents/MacOS/gteam");
        let resource = Path::new("/Applications/gteam.app/Contents/Resources");
        let paths = candidate_paths(Some(exe), Some(resource), "aarch64-apple-darwin", false);
        assert_eq!(
            paths[0],
            PathBuf::from("/Applications/gteam.app/Contents/MacOS/gteam-mcp")
        );
        assert!(paths
            .iter()
            .any(|path| path.ends_with("gteam-mcp-aarch64-apple-darwin")));
        assert!(paths.iter().any(|path| {
            path == Path::new(
                "/Applications/gteam.app/Contents/MacOS/gteam-mcp-aarch64-apple-darwin",
            )
        }));
    }

    #[test]
    fn linux_package_resolves_next_to_the_binary_in_usr_bin() {
        let exe = Path::new("/usr/bin/gteam");
        let paths = candidate_paths(Some(exe), None, "x86_64-unknown-linux-gnu", false);
        assert_eq!(paths[0], PathBuf::from("/usr/bin/gteam-mcp"));
        assert!(paths
            .iter()
            .any(|path| { path == Path::new("/usr/bin/gteam-mcp-x86_64-unknown-linux-gnu") }));
        assert_eq!(
            missing_message("x86_64-unknown-linux-gnu", false),
            "未找到随应用安装的 MCP 程序（gteam-mcp）"
        );
    }

    #[test]
    fn cargo_test_deps_directory_steps_up_like_the_shell_plugin() {
        let exe = Path::new("/tmp/target/debug/deps/gteam-abc");
        let paths = candidate_paths(Some(exe), None, "x86_64-unknown-linux-gnu", false);
        assert_eq!(paths[0], PathBuf::from("/tmp/target/debug/gteam-mcp"));
    }

    #[test]
    fn windows_does_not_append_a_second_exe_suffix() {
        let exe = Path::new("D:/gteam/gteam.exe");
        let path = relative_command_path(exe, Path::new("gteam-mcp.exe"), true).unwrap();
        assert_eq!(path, PathBuf::from("D:/gteam/gteam-mcp.exe"));
    }

    #[test]
    fn non_windows_strips_an_exe_suffix() {
        let exe = Path::new("/usr/bin/gteam");
        let path = relative_command_path(exe, Path::new("gteam-mcp.exe"), false).unwrap();
        assert_eq!(path, PathBuf::from("/usr/bin/gteam-mcp"));
    }

    #[test]
    fn an_existing_installed_file_wins_over_the_triple_named_fallback() {
        let dir = std::env::temp_dir().join(format!("gteam-mcp-path-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("gteam.exe");
        std::fs::write(&exe, b"app").unwrap();
        let triple = dir.join("gteam-mcp-x86_64-pc-windows-msvc.exe");
        std::fs::write(&triple, b"triple").unwrap();

        let only_triple = candidate_paths(Some(&exe), None, "x86_64-pc-windows-msvc", true);
        let found = first_existing(&only_triple).unwrap();
        assert!(found.ends_with("gteam-mcp-x86_64-pc-windows-msvc.exe"));

        let installed = dir.join("gteam-mcp.exe");
        std::fs::write(&installed, b"installed").unwrap();
        let found = first_existing(&candidate_paths(
            Some(&exe),
            None,
            "x86_64-pc-windows-msvc",
            true,
        ))
        .unwrap();
        assert_eq!(found, installed);

        let linux_exe = dir.join("gteam");
        std::fs::write(&linux_exe, b"app").unwrap();
        std::fs::write(dir.join("gteam-mcp"), b"mcp").unwrap();
        let found = first_existing(&candidate_paths(
            Some(&linux_exe),
            None,
            "x86_64-unknown-linux-gnu",
            false,
        ))
        .unwrap();
        assert_eq!(found, dir.join("gteam-mcp"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
