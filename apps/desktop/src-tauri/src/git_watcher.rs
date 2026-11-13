use notify::{Watcher, RecursiveMode, Event, EventKind};
use git2::Repository;
use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitProgressEvent {
    pub repo_path: String,
    pub branch: String,
    pub commit_hash: String,
    pub commit_message: String,
    pub author: String,
    pub timestamp: i64,
}

/// Git 仓库监控器
pub struct GitWatcher {
    watchers: HashMap<String, notify::RecommendedWatcher>,
}

impl GitWatcher {
    pub fn new() -> Self {
        Self {
            watchers: HashMap::new(),
        }
    }

    /// 添加要监控的仓库路径
    pub fn watch_repo(&mut self, repo_path: String, app_handle: AppHandle) -> Result<(), String> {
        let (tx, rx) = channel();
        let path = PathBuf::from(&repo_path);
        
        let mut watcher = notify::recommended_watcher(tx)
            .map_err(|e| format!("Failed to create watcher: {}", e))?;

        watcher
            .watch(&path.join(".git"), RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch path: {}", e))?;

        let repo_path_clone = repo_path.clone();
        let app_handle_clone = app_handle.clone();
        
        // 启动监听线程
        std::thread::spawn(move || {
            for res in rx {
                match res {
                    Ok(Event { kind: EventKind::Modify(_), .. }) |
                    Ok(Event { kind: EventKind::Create(_), .. }) => {
                        if let Some(progress) = Self::get_git_progress(&repo_path_clone) {
                            let _ = app_handle_clone.emit("git-progress", progress);
                        }
                    }
                    _ => {}
                }
            }
        });

        self.watchers.insert(repo_path, watcher);
        Ok(())
    }

    /// 停止监控仓库
    pub fn unwatch_repo(&mut self, repo_path: &str) {
        self.watchers.remove(repo_path);
    }

    /// 获取 Git 进度信息
    fn get_git_progress(repo_path: &str) -> Option<GitProgressEvent> {
        let repo = Repository::open(repo_path).ok()?;
        let head = repo.head().ok()?;
        let commit = head.peel_to_commit().ok()?;
        
        // 提前提取所有需要的数据，避免生命周期问题
        let branch_name = head.shorthand().unwrap_or("unknown").to_string();
        let commit_hash = commit.id().to_string();
        let commit_message = commit.message().unwrap_or("").to_string();
        let author_name = commit.author().name().unwrap_or("unknown").to_string();
        let timestamp = commit.time().seconds();
        
        Some(GitProgressEvent {
            repo_path: repo_path.to_string(),
            branch: branch_name,
            commit_hash,
            commit_message,
            author: author_name,
            timestamp,
        })
    }
}

#[tauri::command]
pub fn start_watching_repo(
    repo_path: String,
    app_handle: AppHandle,
    state: tauri::State<std::sync::Mutex<GitWatcher>>,
) -> Result<(), String> {
    let mut watcher = state.lock().unwrap();
    watcher.watch_repo(repo_path, app_handle)
}

#[tauri::command]
pub fn stop_watching_repo(
    repo_path: String,
    state: tauri::State<std::sync::Mutex<GitWatcher>>,
) -> Result<(), String> {
    let mut watcher = state.lock().unwrap();
    watcher.unwatch_repo(&repo_path);
    Ok(())
}

#[tauri::command]
pub fn get_current_git_status(repo_path: String) -> Result<GitProgressEvent, String> {
    GitWatcher::get_git_progress(&repo_path)
        .ok_or_else(|| "Failed to get git status".to_string())
}
