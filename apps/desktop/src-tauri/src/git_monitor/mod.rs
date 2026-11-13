//! 应用级 Git 监控。
//!
//! 列表按团队保存在本机应用数据目录，启动时恢复。本地仓库用文件通知，
//! 并辅以定时检查；WSL 路径和远程地址只轮询。访问令牌不进入这份列表。

mod classify;
mod probe;
mod secrets;
mod store;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use classify::{map_git2_message, LocationKind};
use probe::{probe, CommitInfo, ProbeRequest};
use store::{BranchMode, MonitorRecord, RepoTarget};

pub struct GitMonitor {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    app: Option<AppHandle>,
    records: Vec<MonitorRecord>,
    watchers: HashMap<String, notify::RecommendedWatcher>,
    last_poll: HashMap<String, Instant>,
    store_path: PathBuf,
    token_path: PathBuf,
    mirror_root: PathBuf,
    poll_started: bool,
    ready: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddGitMonitorInput {
    pub connection_id: String,
    pub location: String,
    #[serde(default = "default_true")]
    pub follow_branch: bool,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub requirement_id: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGitMonitorInput {
    pub id: String,
    pub location: String,
    #[serde(default = "default_true")]
    pub follow_branch: bool,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub requirement_id: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub clear_token: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMonitorDto {
    pub id: String,
    pub connection_id: String,
    pub kind: String,
    pub path: String,
    pub branch_mode: String,
    pub branch: Option<String>,
    pub current_branch: Option<String>,
    pub requirement_id: Option<String>,
    pub has_token: bool,
    pub last_commit: Option<String>,
    pub last_subject: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProgressEvent {
    pub repo_id: String,
    pub connection_id: String,
    pub repo_path: String,
    pub branch: String,
    pub commit_hash: String,
    pub commit_message: String,
    pub author: String,
    pub timestamp: i64,
    pub requirement_id: Option<String>,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            app: None,
            records: Vec::new(),
            watchers: HashMap::new(),
            last_poll: HashMap::new(),
            store_path: PathBuf::new(),
            token_path: PathBuf::new(),
            mirror_root: PathBuf::new(),
            poll_started: false,
            ready: false,
        }
    }
}

impl GitMonitor {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
        }
    }

    fn add(&self, input: AddGitMonitorInput) -> Result<GitMonitorDto, String> {
        let connection_id = input.connection_id.trim().to_string();
        if connection_id.is_empty() {
            return Err("请先选择团队。".into());
        }
        let classified = classify::resolve_location(&input.location)?;
        let branch_mode = classify::parse_branch_mode(input.follow_branch, input.branch)?;
        let requirement_id = classify::normalize_requirement_id(input.requirement_id)?;
        let token = normalize_secret(input.access_token).or(classified.embedded_token);
        let preliminary = to_target(classified.kind);

        {
            let guard = lock(&self.inner);
            ensure_ready(&guard)?;
            if guard.records.iter().any(|record| {
                record.connection_id == connection_id && record.target.dedup_key() == preliminary.dedup_key()
            }) {
                return Err("该仓库已在当前团队的监控列表中，可以直接编辑。".into());
            }
        }

        let id = new_id();
        let mirror = mirror_for_target(&self.inner, &id, &preliminary)?;
        let probe_result = probe(ProbeRequest {
            target: preliminary,
            branch_mode: branch_mode.clone(),
            token: token.clone(),
            mirror_dir: mirror.clone(),
            previous_hash: None,
        });
        let (info, normalized) = match probe_result {
            Ok(value) => value,
            Err(err) => {
                cleanup_mirror(mirror.as_ref());
                return Err(err);
            }
        };

        {
            let guard = lock(&self.inner);
            if guard.records.iter().any(|record| {
                record.connection_id == connection_id && record.target.dedup_key() == normalized.dedup_key()
            }) {
                cleanup_mirror(mirror.as_ref());
                return Err("该仓库已在当前团队的监控列表中，可以直接编辑。".into());
            }
        }

        let token_path = lock(&self.inner).token_path.clone();
        let has_token = match store_token_for_target(&token_path, &id, &normalized, token.as_deref(), false, false) {
            Ok(saved) => saved,
            Err(err) => {
                cleanup_mirror(mirror.as_ref());
                return Err(err);
            }
        };
        let now = now_ms();
        let record = MonitorRecord {
            id: id.clone(),
            connection_id,
            target: normalized.clone(),
            branch_mode,
            requirement_id,
            has_token,
            last_commit: None,
            last_branch: None,
            last_subject: None,
            last_author: None,
            last_timestamp: None,
            last_error: None,
            created_at_ms: now,
            updated_at_ms: now,
        };

        {
            let mut guard = lock(&self.inner);
            guard.records.push(record);
            guard.last_poll.insert(id.clone(), Instant::now());
            guard.apply_success(&id, info, normalized, true);
        }
        if record_uses_notify(&self.inner, &id) {
            if let Err(err) = attach_notify(&self.inner, &id) {
                eprintln!("Git 文件监控未能启动，将改用定时检查：{err}");
            }
        }
        self.dto_by_id(&id)
    }

    fn update(&self, input: UpdateGitMonitorInput) -> Result<GitMonitorDto, String> {
        let id = input.id.trim().to_string();
        let existing = {
            let guard = lock(&self.inner);
            ensure_ready(&guard)?;
            guard
                .records
                .iter()
                .find(|record| record.id == id)
                .cloned()
                .ok_or_else(|| "找不到该监控项，可能已经移除。".to_string())?
        };
        let classified = classify::resolve_location(&input.location)?;
        let embedded = classified.embedded_token.clone();
        let branch_mode = classify::parse_branch_mode(input.follow_branch, input.branch)?;
        let requirement_id = classify::normalize_requirement_id(input.requirement_id)?;
        let requirement_changed = requirement_id != existing.requirement_id;
        let branch_changed = branch_mode != existing.branch_mode;
        let new_token = normalize_secret(input.access_token).or(embedded);
        let clear_token = input.clear_token && new_token.is_none();

        let token_path = lock(&self.inner).token_path.clone();
        let mirror_root = lock(&self.inner).mirror_root.clone();
        let existing_token = if existing.has_token {
            secrets::load_token(&token_path, &id)
        } else {
            None
        };
        let probe_token = if clear_token {
            None
        } else if new_token.is_some() {
            new_token.clone()
        } else {
            existing_token
        };

        let preliminary = to_target(classified.kind);
        if should_reset_mirror(&existing.target, &preliminary) {
            if let Ok(dir) = mirror_dir(&mirror_root, &id) {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
        let mirror = mirror_for_path(&mirror_root, &id, &preliminary)?;
        let (info, normalized) = probe(ProbeRequest {
            target: preliminary,
            branch_mode: branch_mode.clone(),
            token: probe_token,
            mirror_dir: mirror,
            previous_hash: None,
        })?;

        {
            let guard = lock(&self.inner);
            if guard.records.iter().any(|record| {
                record.id != id
                    && record.connection_id == existing.connection_id
                    && record.target.dedup_key() == normalized.dedup_key()
            }) {
                return Err("该仓库已在当前团队的监控列表中。".into());
            }
        }

        let has_token = store_token_for_target(
            &token_path,
            &id,
            &normalized,
            new_token.as_deref(),
            clear_token,
            existing.has_token,
        )?;

        let force = requirement_changed || branch_changed;
        {
            let mut guard = lock(&self.inner);
            let Some(record) = guard.records.iter_mut().find(|record| record.id == id) else {
                return Err("找不到该监控项，可能已经移除。".into());
            };
            record.target = normalized.clone();
            record.branch_mode = branch_mode;
            record.requirement_id = requirement_id;
            record.has_token = has_token;
            record.updated_at_ms = now_ms();
            if force {
                record.last_commit = None;
            }
            guard.last_poll.insert(id.clone(), Instant::now());
            guard.apply_success(&id, info, normalized, force);
        }
        rebind_watcher(&self.inner, &id);
        self.dto_by_id(&id)
    }

    fn remove(&self, id: &str) -> Result<(), String> {
        let id = id.trim();
        if !store::safe_id(id) {
            return Err("找不到该监控项，可能已经移除。".into());
        }
        let (token_path, mirror_root) = {
            let mut guard = lock(&self.inner);
            ensure_ready(&guard)?;
            if !guard.records.iter().any(|record| record.id == id) {
                return Err("找不到该监控项，可能已经移除。".into());
            }
            guard.records.retain(|record| record.id != id);
            guard.last_poll.remove(id);
            guard.watchers.remove(id);
            guard.persist()?;
            (guard.token_path.clone(), guard.mirror_root.clone())
        };
        secrets::delete_token(&token_path, id);
        if let Ok(dir) = mirror_dir(&mirror_root, id) {
            let _ = std::fs::remove_dir_all(dir);
        }
        Ok(())
    }

    fn list(&self) -> Result<Vec<GitMonitorDto>, String> {
        let guard = lock(&self.inner);
        ensure_ready(&guard)?;
        Ok(guard.records.iter().map(to_dto).collect())
    }

    fn dto_by_id(&self, id: &str) -> Result<GitMonitorDto, String> {
        lock(&self.inner)
            .records
            .iter()
            .find(|record| record.id == id)
            .map(to_dto)
            .ok_or_else(|| "保存监控项失败。".to_string())
    }
}

pub fn init(app: &AppHandle) {
    let monitor = app.state::<GitMonitor>();
    let arc = monitor.inner.clone();
    let dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("Git 监控初始化失败，无法访问应用数据目录：{err}");
            return;
        }
    };
    if let Err(err) = std::fs::create_dir_all(&dir) {
        eprintln!("Git 监控初始化失败，无法创建数据目录：{err}");
        return;
    }
    let store_path = dir.join("git-monitors.json");
    let token_path = dir.join("git-access-tokens.json");
    let mirror_root = dir.join("git-mirrors");
    if let Err(err) = std::fs::create_dir_all(&mirror_root) {
        eprintln!("Git 监控初始化失败，无法创建镜像目录：{err}");
        return;
    }
    let records = match store::load_records(&store_path) {
        Ok(records) => records,
        Err(err) => {
            eprintln!("Git 监控列表读取失败，将从空列表开始：{err}");
            Vec::new()
        }
    };
    {
        let mut guard = lock(&arc);
        guard.app = Some(app.clone());
        guard.store_path = store_path;
        guard.token_path = token_path;
        guard.mirror_root = mirror_root;
        guard.records = records;
        guard.ready = true;
        if !guard.poll_started {
            guard.poll_started = true;
            let poll_arc = arc.clone();
            if let Err(err) = std::thread::Builder::new()
                .name("git-monitor-poll".into())
                .spawn(move || poll_loop(poll_arc))
            {
                eprintln!("Git 监控轮询线程启动失败：{err}");
            }
        }
    }
    let ids: Vec<String> = {
        let guard = lock(&arc);
        guard
            .records
            .iter()
            .filter(|record| record.target.uses_filesystem_notify())
            .map(|record| record.id.clone())
            .collect()
    };
    for id in ids {
        if let Err(err) = attach_notify(&arc, &id) {
            eprintln!("Git 文件监控未能启动，将改用定时检查：{err}");
        }
    }
}

#[tauri::command]
pub fn list_git_monitors(state: State<'_, GitMonitor>) -> Result<Vec<GitMonitorDto>, String> {
    state.list()
}

#[tauri::command]
pub fn add_git_monitor(state: State<'_, GitMonitor>, input: AddGitMonitorInput) -> Result<GitMonitorDto, String> {
    state.add(input)
}

#[tauri::command]
pub fn update_git_monitor(
    state: State<'_, GitMonitor>,
    input: UpdateGitMonitorInput,
) -> Result<GitMonitorDto, String> {
    state.update(input)
}

#[tauri::command]
pub fn remove_git_monitor(state: State<'_, GitMonitor>, id: String) -> Result<(), String> {
    state.remove(&id)
}

impl Inner {
    fn persist(&self) -> Result<(), String> {
        if self.store_path.as_os_str().is_empty() {
            return Err("Git 监控尚未就绪，请稍后再试。".into());
        }
        store::save_records(&self.store_path, &self.records)
    }

    fn apply_success(&mut self, id: &str, info: CommitInfo, normalized: RepoTarget, force: bool) {
        let Some(index) = self.records.iter().position(|record| record.id == id) else {
            return;
        };
        let connection_id = self.records[index].connection_id.clone();
        let dedup = normalized.dedup_key();
        let collision = self.records.iter().any(|record| {
            record.id != id && record.connection_id == connection_id && record.target.dedup_key() == dedup
        });
        if !collision {
            self.records[index].target = normalized;
        }

        let hash_changed = self.records[index].last_commit.as_deref() != Some(info.hash.as_str());
        let branch_changed = self.records[index].last_branch.as_deref() != Some(info.branch.as_str());
        let had_error = self.records[index].last_error.is_some();
        if !info.subject.is_empty() {
            self.records[index].last_subject = Some(info.subject.clone());
        }
        if !info.author.is_empty() {
            self.records[index].last_author = Some(info.author.clone());
        }
        if info.timestamp != 0 {
            self.records[index].last_timestamp = Some(info.timestamp);
        }
        self.records[index].last_commit = Some(info.hash.clone());
        self.records[index].last_branch = Some(info.branch.clone());
        self.records[index].last_error = None;
        self.records[index].updated_at_ms = now_ms();

        let subject = self.records[index].last_subject.clone().unwrap_or_default();
        let author = self.records[index].last_author.clone().unwrap_or_default();
        let timestamp = self.records[index].last_timestamp.unwrap_or(0);
        let event = GitProgressEvent {
            repo_id: self.records[index].id.clone(),
            connection_id: self.records[index].connection_id.clone(),
            repo_path: self.records[index].target.display_path().to_string(),
            branch: info.branch,
            commit_hash: info.hash,
            commit_message: subject,
            author,
            timestamp,
            requirement_id: self.records[index].requirement_id.clone(),
        };
        let dto = to_dto(&self.records[index]);
        let should_emit = (force || hash_changed || branch_changed) && !event.commit_hash.is_empty();
        if should_emit || had_error || hash_changed {
            if let Err(err) = self.persist() {
                eprintln!("保存 Git 监控列表失败：{err}");
            }
        }
        if should_emit {
            self.emit_progress(&event);
        }
        if should_emit || had_error {
            self.emit_updated(&dto);
        }
    }

    fn apply_error(&mut self, id: &str, message: String) {
        let Some(record) = self.records.iter_mut().find(|record| record.id == id) else {
            return;
        };
        if record.last_error.as_deref() == Some(message.as_str()) {
            return;
        }
        record.last_error = Some(message);
        record.updated_at_ms = now_ms();
        let dto = to_dto(record);
        if let Err(err) = self.persist() {
            eprintln!("保存 Git 监控列表失败：{err}");
        }
        self.emit_updated(&dto);
    }

    fn emit_progress(&self, event: &GitProgressEvent) {
        if let Some(app) = &self.app {
            let _ = app.emit("git-progress", event);
        }
    }

    fn emit_updated(&self, dto: &GitMonitorDto) {
        if let Some(app) = &self.app {
            let _ = app.emit("git-monitor-updated", dto);
        }
    }
}

fn poll_loop(arc: Arc<Mutex<Inner>>) {
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let due: Vec<String> = {
            let guard = lock(&arc);
            if !guard.ready {
                continue;
            }
            let now = Instant::now();
            guard
                .records
                .iter()
                .filter_map(|record| {
                    let due = match guard.last_poll.get(&record.id) {
                        None => true,
                        Some(last) => now.duration_since(*last) >= record.target.poll_interval(),
                    };
                    due.then(|| record.id.clone())
                })
                .collect()
        };
        for id in due {
            {
                let mut guard = lock(&arc);
                guard.last_poll.insert(id.clone(), Instant::now());
            }
            refresh_id(&arc, &id, false);
        }
    }
}

fn refresh_id(arc: &Arc<Mutex<Inner>>, id: &str, force: bool) {
    let snapshot = {
        let guard = lock(arc);
        let Some(record) = guard.records.iter().find(|record| record.id == id).cloned() else {
            return;
        };
        let token = if record.has_token {
            secrets::load_token(&guard.token_path, id)
        } else {
            None
        };
        let mirror = if matches!(record.target, RepoTarget::Remote { .. }) {
            mirror_dir(&guard.mirror_root, id).ok()
        } else {
            None
        };
        (record, token, mirror)
    };
    let (record, token, mirror) = snapshot;
    let result = probe(ProbeRequest {
        target: record.target,
        branch_mode: record.branch_mode,
        token,
        mirror_dir: mirror,
        previous_hash: record.last_commit,
    });
    let mut guard = lock(arc);
    if !guard.records.iter().any(|item| item.id == id) {
        return;
    }
    match result {
        Ok((info, normalized)) => guard.apply_success(id, info, normalized, force),
        Err(err) => guard.apply_error(id, err),
    }
}

fn attach_notify(arc: &Arc<Mutex<Inner>>, id: &str) -> Result<(), String> {
    let path = {
        let guard = lock(arc);
        match guard.records.iter().find(|record| record.id == id).map(|record| record.target.clone()) {
            Some(RepoTarget::Local { path }) => path,
            _ => return Ok(()),
        }
    };
    let git_dir = git_dir_for_watch(&path)?;
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx).map_err(|err| format!("无法创建文件监控：{err}"))?;
    watcher
        .watch(&git_dir, RecursiveMode::Recursive)
        .map_err(|err| format!("无法监控 Git 目录：{err}"))?;
    let thread_arc = arc.clone();
    let thread_id = id.to_string();
    std::thread::Builder::new()
        .name(format!("git-watch-{id}"))
        .spawn(move || watch_loop(rx, thread_arc, thread_id))
        .map_err(|err| format!("无法启动监控线程：{err}"))?;
    lock(arc).watchers.insert(id.to_string(), watcher);
    Ok(())
}

fn watch_loop(rx: mpsc::Receiver<Result<Event, notify::Error>>, arc: Arc<Mutex<Inner>>, id: String) {
    loop {
        let first = match rx.recv() {
            Ok(event) => event,
            Err(_) => break,
        };
        let mut relevant = event_is_interesting(first.as_ref().ok());
        let quiet_until = Instant::now() + Duration::from_millis(400);
        loop {
            let now = Instant::now();
            if now >= quiet_until {
                break;
            }
            match rx.recv_timeout(quiet_until.saturating_duration_since(now)) {
                Ok(event) => {
                    if event_is_interesting(event.as_ref().ok()) {
                        relevant = true;
                    }
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    if relevant {
                        refresh_id(&arc, &id, false);
                    }
                    return;
                }
            }
        }
        if relevant {
            refresh_id(&arc, &id, false);
        }
    }
}

fn event_is_interesting(event: Option<&Event>) -> bool {
    let Some(event) = event else {
        return false;
    };
    let kind_ok = matches!(
        event.kind,
        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
    );
    if !kind_ok {
        return false;
    }
    if event.paths.is_empty() {
        return true;
    }
    event.paths.iter().any(|path| {
        let text = path.to_string_lossy();
        text.contains("HEAD") || text.contains("refs") || text.contains("packed-refs")
    })
}

fn rebind_watcher(arc: &Arc<Mutex<Inner>>, id: &str) {
    lock(arc).watchers.remove(id);
    if record_uses_notify(arc, id) {
        if let Err(err) = attach_notify(arc, id) {
            eprintln!("Git 文件监控未能启动，将改用定时检查：{err}");
        }
    }
}

fn record_uses_notify(arc: &Arc<Mutex<Inner>>, id: &str) -> bool {
    lock(arc)
        .records
        .iter()
        .find(|record| record.id == id)
        .map(|record| record.target.uses_filesystem_notify())
        .unwrap_or(false)
}

fn git_dir_for_watch(path: &str) -> Result<PathBuf, String> {
    let repo = git2::Repository::open(path)
        .or_else(|_| git2::Repository::discover(path))
        .map_err(|err| map_git2_message(err.message(), path))?;
    Ok(repo.path().to_path_buf())
}

fn to_target(kind: LocationKind) -> RepoTarget {
    match kind {
        LocationKind::Local { path } => RepoTarget::Local { path },
        LocationKind::Wsl {
            distro,
            linux_path,
            display_path,
        } => RepoTarget::Wsl {
            distro,
            linux_path,
            display_path,
        },
        LocationKind::Remote { url } => RepoTarget::Remote { url },
    }
}

fn to_dto(record: &MonitorRecord) -> GitMonitorDto {
    let (branch_mode, branch) = match &record.branch_mode {
        BranchMode::Follow => ("follow".to_string(), None),
        BranchMode::Pin { name } => ("pin".to_string(), Some(name.clone())),
    };
    GitMonitorDto {
        id: record.id.clone(),
        connection_id: record.connection_id.clone(),
        kind: record.target.kind_name().to_string(),
        path: record.target.display_path().to_string(),
        branch_mode,
        branch,
        current_branch: record.last_branch.clone(),
        requirement_id: record.requirement_id.clone(),
        has_token: record.has_token,
        last_commit: record.last_commit.clone(),
        last_subject: record.last_subject.clone(),
        last_error: record.last_error.clone(),
    }
}

fn store_token_for_target(
    token_path: &std::path::Path,
    id: &str,
    target: &RepoTarget,
    token: Option<&str>,
    clear: bool,
    had_token: bool,
) -> Result<bool, String> {
    // 本地和 WSL 仓库不使用访问令牌。只有确实保存过时才访问钥匙串，避免无谓的系统调用。
    if !matches!(target, RepoTarget::Remote { .. }) || clear {
        if had_token {
            secrets::delete_token(token_path, id);
        }
        return Ok(false);
    }
    if let Some(token) = token {
        secrets::save_token(token_path, id, token)?;
        return Ok(true);
    }
    Ok(had_token)
}

fn mirror_for_target(inner: &Arc<Mutex<Inner>>, id: &str, target: &RepoTarget) -> Result<Option<PathBuf>, String> {
    let root = lock(inner).mirror_root.clone();
    mirror_for_path(&root, id, target)
}

fn mirror_for_path(root: &std::path::Path, id: &str, target: &RepoTarget) -> Result<Option<PathBuf>, String> {
    if matches!(target, RepoTarget::Remote { .. }) {
        Ok(Some(mirror_dir(root, id)?))
    } else {
        Ok(None)
    }
}

fn mirror_dir(root: &std::path::Path, id: &str) -> Result<PathBuf, String> {
    if !store::safe_id(id) {
        return Err("内部错误：监控项 ID 无效。".into());
    }
    Ok(root.join(id))
}

fn cleanup_mirror(path: Option<&PathBuf>) {
    if let Some(path) = path {
        if path.exists() {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn should_reset_mirror(old: &RepoTarget, new: &RepoTarget) -> bool {
    match (old, new) {
        (RepoTarget::Remote { url: left }, RepoTarget::Remote { url: right }) => left != right,
        (RepoTarget::Remote { .. }, _) => true,
        _ => false,
    }
}

fn normalize_secret(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn ensure_ready(inner: &Inner) -> Result<(), String> {
    if inner.ready {
        Ok(())
    } else {
        Err("Git 监控尚未就绪，请稍后再试。".into())
    }
}

fn lock(inner: &Mutex<Inner>) -> MutexGuard<'_, Inner> {
    inner.lock().unwrap_or_else(|err| err.into_inner())
}

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let millis = now_ms();
    let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{millis}-{sequence}")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_event_never_carries_an_access_token() {
        let event = GitProgressEvent {
            repo_id: "1".into(),
            connection_id: "team".into(),
            repo_path: "https://github.com/ncwtf/gteam".into(),
            branch: "main".into(),
            commit_hash: "abc".into(),
            commit_message: "hello".into(),
            author: "Ada".into(),
            timestamp: 1,
            requirement_id: None,
        };
        let value = serde_json::to_value(&event).unwrap();
        let object = value.as_object().unwrap();
        assert!(object.keys().all(|key| !key.to_ascii_lowercase().contains("token")));
        assert_eq!(object.get("repoPath").and_then(|item| item.as_str()), Some("https://github.com/ncwtf/gteam"));
        assert!(object.get("requirementId").unwrap().is_null());
    }

    #[test]
    fn embedded_token_is_not_part_of_the_stored_target() {
        let classified = super::classify::resolve_location("https://user:ghp_secretvalue@github.com/ncwtf/gteam").unwrap();
        let super::classify::ClassifiedLocation { kind, embedded_token } = classified;
        assert_eq!(embedded_token.as_deref(), Some("user:ghp_secretvalue"));
        let target = super::to_target(kind);
        let json = serde_json::to_string(&target).unwrap();
        assert!(!json.contains("ghp_secretvalue"));
        assert!(json.contains("https://github.com/ncwtf/gteam"));
    }
}
