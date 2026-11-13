//! 后台 Git 监控。配置按团队保存在本机，监听不依赖设置页是否打开。
//! 访问令牌只存在应用数据目录的 secrets 文件中，不会放进进度事件，也不会发给 gteam 服务器。

use crate::git_monitor::*;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddGitMonitorRequest {
    pub connection_id: String,
    pub source: String,
    pub follow_branch: bool,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub requirement_id: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGitMonitorRequest {
    pub id: String,
    pub follow_branch: bool,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub requirement_id: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub clear_access_token: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMonitorStatusEvent {
    pub id: String,
    pub status: MonitorStatus,
    pub status_message: Option<String>,
    pub ownership_note: Option<String>,
    pub current_branch: Option<String>,
    pub sync_error: Option<String>,
}

struct ActiveWatch {
    generation: u64,
    stop: Arc<AtomicBool>,
    notify: Option<RecommendedWatcher>,
}

struct Inner {
    data_dir: std::path::PathBuf,
    monitors: Vec<Monitor>,
    secrets: HashMap<String, String>,
    active: HashMap<String, ActiveWatch>,
    next_generation: u64,
    reservations: HashSet<String>,
}

pub struct GitWatcher {
    inner: Arc<Mutex<Inner>>,
}

impl GitWatcher {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                data_dir: std::path::PathBuf::new(),
                monitors: Vec::new(),
                secrets: HashMap::new(),
                active: HashMap::new(),
                next_generation: 1,
                reservations: HashSet::new(),
            })),
        }
    }
}

enum Outgoing {
    Progress(GitProgressEvent),
    Status(GitMonitorStatusEvent),
}

struct GitRunError {
    message: String,
    raw: String,
}

pub fn restore(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<GitWatcher>();
    if let Err(err) = ensure_ready(&state, app) {
        eprintln!("恢复 Git 监控失败：{err}");
    }
    Ok(())
}

#[tauri::command]
pub fn list_git_monitors(
    app: AppHandle,
    state: State<'_, GitWatcher>,
) -> Result<Vec<GitMonitorDto>, String> {
    ensure_ready(&state, &app)?;
    let inner = lock(&state);
    Ok(inner
        .monitors
        .iter()
        .map(|monitor| to_dto(monitor, inner.secrets.contains_key(&monitor.id)))
        .collect())
}

#[tauri::command]
pub fn inspect_git_source(source: String) -> Result<GitSourceInspection, String> {
    let classified = classify_source(&source)?;
    match classified.kind {
        SourceKind::Local => inspect_local(&classified.normalized),
        kind => Ok(GitSourceInspection {
            kind,
            normalized_source: classified.normalized,
            current_branch: None,
            ownership_note: None,
            has_commits: false,
        }),
    }
}

#[tauri::command]
pub fn add_git_monitor(
    request: AddGitMonitorRequest,
    app: AppHandle,
    state: State<'_, GitWatcher>,
) -> Result<GitMonitorDto, String> {
    ensure_ready(&state, &app)?;
    if request.connection_id.trim().is_empty() {
        return Err("请先选择一个团队".into());
    }
    let classified = classify_source(&request.source)?;
    let follow = request.follow_branch;
    let branch = if follow {
        None
    } else {
        normalize_branch(request.branch.clone())
    };
    if !follow {
        validate_branch_name(branch.as_deref().unwrap_or(""))?;
    }
    let requirement_id = normalize_requirement_id(request.requirement_id.clone());
    let token = pick_token(
        request.access_token.clone(),
        classified.embedded_token.clone(),
        classified.kind,
    );
    let reservation = duplicate_key(&request.connection_id, &classified);
    {
        let mut inner = lock(&state);
        if inner
            .monitors
            .iter()
            .any(|monitor| monitor_key(monitor) == reservation)
            || !inner.reservations.insert(reservation.clone())
        {
            return Err("当前团队已在监控该仓库。可以在列表里修改分支或需求。".into());
        }
    }
    let _reservation = ReservationGuard {
        inner: state.inner.clone(),
        key: reservation,
    };

    let id = new_id();
    let data_dir = lock(&state).data_dir.clone();
    let local_path = if classified.kind == SourceKind::Local {
        classified.normalized.clone()
    } else {
        mirror_dir(&data_dir, &id).display().to_string()
    };
    let mut monitor = Monitor {
        id: id.clone(),
        connection_id: request.connection_id.trim().to_string(),
        source: classified.normalized.clone(),
        kind: classified.kind,
        local_path: local_path.clone(),
        follow_branch: follow,
        branch: branch.clone(),
        current_branch: None,
        requirement_id,
        status: MonitorStatus::Watching,
        status_message: None,
        ownership_note: None,
        sync_error: None,
        last_seen: None,
        last_acked_hash: None,
    };

    let prepared = (|| -> Result<Option<GitProgressEvent>, String> {
        if classified.kind == SourceKind::Local {
            let inspection = inspect_local(&classified.normalized)?;
            monitor.current_branch = inspection.current_branch.clone();
            monitor.ownership_note = inspection.ownership_note;
            let outcome = read_repo(&classified.normalized, follow, branch.as_deref())?;
            remember_outcome(&mut monitor, &outcome);
        } else {
            ensure_mirror(&monitor, token.as_deref(), true)?;
            let outcome = read_repo(&monitor.local_path, follow, branch.as_deref())?;
            remember_outcome(&mut monitor, &outcome);
        }
        Ok(monitor
            .last_seen
            .as_ref()
            .and_then(|commit| progress_event(&monitor, commit)))
    })();

    let initial_event = match prepared {
        Ok(event) => event,
        Err(err) => {
            if classified.kind.is_remote() {
                let _ = fs::remove_dir_all(&local_path);
            }
            return Err(err);
        }
    };

    let dto = {
        let mut inner = lock(&state);
        if inner
            .monitors
            .iter()
            .any(|existing| monitor_key(existing) == _reservation.key)
        {
            if classified.kind.is_remote() {
                let _ = fs::remove_dir_all(&local_path);
            }
            return Err("当前团队已在监控该仓库。可以在列表里修改分支或需求。".into());
        }
        if let Some(secret) = token.clone() {
            inner.secrets.insert(id.clone(), secret);
            if let Err(err) = save_secrets(&inner.data_dir, &inner.secrets) {
                inner.secrets.remove(&id);
                if classified.kind.is_remote() {
                    let _ = fs::remove_dir_all(&local_path);
                }
                return Err(err);
            }
        }
        inner.monitors.push(monitor.clone());
        if let Err(err) = save_monitors(&inner.data_dir, &inner.monitors) {
            inner.monitors.pop();
            inner.secrets.remove(&id);
            let _ = save_secrets(&inner.data_dir, &inner.secrets);
            if classified.kind.is_remote() {
                let _ = fs::remove_dir_all(&local_path);
            }
            return Err(err);
        }
        to_dto(&monitor, inner.secrets.contains_key(&id))
    };

    start_monitor(&state, &app, &id);
    if let Some(event) = initial_event {
        let _ = app.emit("git-progress", &event);
    }
    Ok(dto)
}

#[tauri::command]
pub fn update_git_monitor(
    request: UpdateGitMonitorRequest,
    app: AppHandle,
    state: State<'_, GitWatcher>,
) -> Result<GitMonitorDto, String> {
    ensure_ready(&state, &app)?;
    let follow = request.follow_branch;
    let branch = if follow {
        None
    } else {
        normalize_branch(request.branch.clone())
    };
    if !follow {
        validate_branch_name(branch.as_deref().unwrap_or(""))?;
    }
    let requirement_id = normalize_requirement_id(request.requirement_id.clone());
    let existing = {
        let inner = lock(&state);
        inner
            .monitors
            .iter()
            .find(|monitor| monitor.id == request.id)
            .cloned()
            .ok_or_else(|| "找不到该监控项".to_string())?
    };
    let stored_token = lock(&state).secrets.get(&existing.id).cloned();
    let next_token = if request.clear_access_token {
        None
    } else {
        normalize_secret(request.access_token.clone()).or(stored_token)
    };
    if !follow {
        verify_branch(&existing, branch.as_deref(), next_token.as_deref())?;
    }

    let (dto, initial) = {
        let mut inner = lock(&state);
        let index = inner
            .monitors
            .iter()
            .position(|monitor| monitor.id == request.id)
            .ok_or_else(|| "找不到该监控项".to_string())?;
        let mut initial = None;
        {
            let monitor = &mut inner.monitors[index];
            monitor.follow_branch = follow;
            monitor.branch = branch;
            let requirement_changed = monitor.requirement_id != requirement_id;
            monitor.requirement_id = requirement_id;
            if monitor.requirement_id.is_none() {
                if let Some(seen) = &monitor.last_seen {
                    monitor.last_acked_hash = Some(seen.hash.clone());
                }
                monitor.sync_error = None;
            } else if requirement_changed {
                monitor.last_acked_hash = None;
                monitor.sync_error = None;
                if let Some(commit) = monitor.last_seen.clone() {
                    initial = progress_event(monitor, &commit);
                }
            }
        }
        if existing.kind == SourceKind::RemoteHttps {
            if let Some(secret) = normalize_secret(request.access_token.clone()) {
                inner.secrets.insert(request.id.clone(), secret);
            } else if request.clear_access_token {
                inner.secrets.remove(&request.id);
            }
            save_secrets(&inner.data_dir, &inner.secrets)?;
        }
        save_monitors(&inner.data_dir, &inner.monitors)?;
        let monitor = &inner.monitors[index];
        let dto = to_dto(monitor, inner.secrets.contains_key(&monitor.id));
        (dto, initial)
    };

    start_monitor(&state, &app, &request.id);
    if let Some(event) = initial {
        let _ = app.emit("git-progress", &event);
    }
    Ok(dto)
}

#[tauri::command]
pub fn remove_git_monitor(
    id: String,
    app: AppHandle,
    state: State<'_, GitWatcher>,
) -> Result<(), String> {
    ensure_ready(&state, &app)?;
    stop_monitor(&state, &id);
    let removed = {
        let mut inner = lock(&state);
        let Some(index) = inner.monitors.iter().position(|monitor| monitor.id == id) else {
            return Ok(());
        };
        let removed = inner.monitors.remove(index);
        inner.secrets.remove(&id);
        save_monitors(&inner.data_dir, &inner.monitors)?;
        save_secrets(&inner.data_dir, &inner.secrets)?;
        removed
    };
    if removed.kind.is_remote() {
        let _ = fs::remove_dir_all(&removed.local_path);
    }
    Ok(())
}

#[tauri::command]
pub fn pending_git_progress(
    app: AppHandle,
    state: State<'_, GitWatcher>,
) -> Result<Vec<GitProgressEvent>, String> {
    ensure_ready(&state, &app)?;
    let inner = lock(&state);
    Ok(inner
        .monitors
        .iter()
        .filter_map(|monitor| {
            let seen = monitor.last_seen.as_ref()?;
            if monitor.last_acked_hash.as_deref() == Some(seen.hash.as_str()) {
                return None;
            }
            progress_event(monitor, seen)
        })
        .collect())
}

#[tauri::command]
pub fn ack_git_progress(
    id: String,
    hash: String,
    app: AppHandle,
    state: State<'_, GitWatcher>,
) -> Result<(), String> {
    ensure_ready(&state, &app)?;
    let status = {
        let mut inner = lock(&state);
        let Some(index) = inner.monitors.iter().position(|monitor| monitor.id == id) else {
            return Ok(());
        };
        if inner.monitors[index]
            .last_seen
            .as_ref()
            .map(|commit| commit.hash.as_str())
            != Some(hash.as_str())
        {
            return Ok(());
        }
        inner.monitors[index].last_acked_hash = Some(hash);
        inner.monitors[index].sync_error = None;
        save_monitors(&inner.data_dir, &inner.monitors)?;
        status_event(&inner.monitors[index])
    };
    let _ = app.emit("git-monitor-status", &status);
    Ok(())
}

#[tauri::command]
pub fn set_git_sync_error(
    id: String,
    message: Option<String>,
    app: AppHandle,
    state: State<'_, GitWatcher>,
) -> Result<(), String> {
    ensure_ready(&state, &app)?;
    let status = {
        let mut inner = lock(&state);
        let Some(index) = inner.monitors.iter().position(|monitor| monitor.id == id) else {
            return Ok(());
        };
        let next = normalize_requirement_id(message);
        if inner.monitors[index].sync_error == next {
            return Ok(());
        }
        inner.monitors[index].sync_error = next;
        save_monitors(&inner.data_dir, &inner.monitors)?;
        status_event(&inner.monitors[index])
    };
    let _ = app.emit("git-monitor-status", &status);
    Ok(())
}

fn ensure_ready(state: &GitWatcher, app: &AppHandle) -> Result<(), String> {
    let pending = {
        let mut inner = lock(state);
        if inner.data_dir.as_os_str().is_empty() {
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|err| format!("无法定位应用数据目录：{err}"))?;
            fs::create_dir_all(&dir).map_err(|err| format!("无法创建应用数据目录：{err}"))?;
            // 读取失败时不把空列表写回去，避免一次损坏或临时 IO 错误清掉已保存的监控和令牌。
            let monitors = load_monitors(&dir)?;
            let secrets = load_secrets(&dir)?;
            inner.monitors = monitors;
            inner.secrets = secrets;
            inner.data_dir = dir;
        }
        inner
            .monitors
            .iter()
            .filter(|monitor| !inner.active.contains_key(&monitor.id))
            .map(|monitor| monitor.id.clone())
            .collect::<Vec<_>>()
    };
    for id in pending {
        start_monitor(state, app, &id);
    }
    Ok(())
}

fn start_monitor(state: &GitWatcher, app: &AppHandle, id: &str) {
    let previous = {
        let mut inner = lock(state);
        inner.active.remove(id)
    };
    if let Some(previous) = previous {
        previous.stop.store(true, Ordering::Relaxed);
        drop(previous);
    }

    let monitor = {
        let inner = lock(state);
        inner
            .monitors
            .iter()
            .find(|monitor| monitor.id == id)
            .cloned()
    };
    let Some(monitor) = monitor else {
        return;
    };

    let stop = Arc::new(AtomicBool::new(false));
    let kick = Arc::new(AtomicBool::new(false));
    let strategy = plan_watch(&monitor.source)
        .unwrap_or_else(|_| watch_strategy(monitor.kind, &monitor.local_path));
    let notify = if strategy == WatchStrategy::Notify {
        match install_notify(&monitor.local_path, kick.clone()) {
            Ok(watcher) => Some(watcher),
            Err(_) => None,
        }
    } else {
        None
    };

    let generation = {
        let mut inner = lock(state);
        let generation = inner.next_generation;
        inner.next_generation = inner.next_generation.wrapping_add(1);
        inner.active.insert(
            id.to_string(),
            ActiveWatch {
                generation,
                stop: stop.clone(),
                notify,
            },
        );
        generation
    };

    let inner = state.inner.clone();
    let app = app.clone();
    let id = id.to_string();
    thread::spawn(move || poll_loop(inner, app, id, generation, stop, kick));
}

fn stop_monitor(state: &GitWatcher, id: &str) {
    let previous = {
        let mut inner = lock(state);
        inner.active.remove(id)
    };
    if let Some(previous) = previous {
        previous.stop.store(true, Ordering::Relaxed);
        drop(previous);
    }
}

fn poll_loop(
    inner: Arc<Mutex<Inner>>,
    app: AppHandle,
    id: String,
    generation: u64,
    stop: Arc<AtomicBool>,
    kick: Arc<AtomicBool>,
) {
    while !stop.load(Ordering::Relaxed) {
        if !generation_is_current(&inner, &id, generation) {
            return;
        }
        run_check(&inner, &app, &id, generation);
        let interval = current_interval(&inner, &id);
        let mut waited = Duration::ZERO;
        while waited < interval && !stop.load(Ordering::Relaxed) {
            if kick.swap(false, Ordering::AcqRel) {
                break;
            }
            thread::sleep(Duration::from_millis(200));
            waited += Duration::from_millis(200);
        }
    }
}

fn run_check(inner: &Arc<Mutex<Inner>>, app: &AppHandle, id: &str, generation: u64) {
    let prepared = {
        let guard = lock_arc(inner);
        if guard.active.get(id).map(|active| active.generation) != Some(generation) {
            return;
        }
        let monitor = guard
            .monitors
            .iter()
            .find(|monitor| monitor.id == id)
            .cloned();
        let token = guard.secrets.get(id).cloned();
        monitor.map(|monitor| (monitor, token))
    };
    let Some((monitor, token)) = prepared else {
        return;
    };
    let result = evaluate(&monitor, token.as_deref());
    drop(token);
    let events = {
        let mut guard = lock_arc(inner);
        if guard.active.get(id).map(|active| active.generation) != Some(generation) {
            return;
        }
        apply_result(&mut guard, id, result)
    };
    emit_all(app, events);
}

fn evaluate(monitor: &Monitor, token: Option<&str>) -> Result<ReadOutcome, String> {
    if monitor.kind.is_remote() {
        ensure_mirror(monitor, token, true)?;
    }
    let pin = if monitor.follow_branch {
        None
    } else {
        monitor.branch.as_deref()
    };
    read_repo(&monitor.local_path, monitor.follow_branch, pin)
}

fn apply_result(inner: &mut Inner, id: &str, result: Result<ReadOutcome, String>) -> Vec<Outgoing> {
    let Some(index) = inner.monitors.iter().position(|monitor| monitor.id == id) else {
        return Vec::new();
    };
    let mut changed = false;
    let mut progress = None;
    match result {
        Err(message) => {
            let monitor = &mut inner.monitors[index];
            if monitor.status != MonitorStatus::Error
                || monitor.status_message.as_deref() != Some(message.as_str())
            {
                monitor.status = MonitorStatus::Error;
                monitor.status_message = Some(message);
                changed = true;
            }
        }
        Ok(outcome) => {
            let monitor = &mut inner.monitors[index];
            if monitor.status != MonitorStatus::Watching {
                monitor.status = MonitorStatus::Watching;
                changed = true;
            }
            if monitor.ownership_note != outcome.ownership_note {
                monitor.ownership_note = outcome.ownership_note.clone();
                changed = true;
            }
            let branch_name = outcome
                .commit
                .as_ref()
                .filter(|_| monitor.follow_branch)
                .map(|commit| commit.branch.clone())
                .or_else(|| outcome.current_branch.clone());
            if monitor.current_branch != branch_name {
                monitor.current_branch = branch_name;
                changed = true;
            }
            if let Some(commit) = outcome.commit.clone() {
                let is_new = monitor.last_seen.as_ref().map(|seen| seen.hash.as_str())
                    != Some(commit.hash.as_str());
                if is_new {
                    monitor.last_seen = Some(commit.clone());
                    monitor.sync_error = None;
                    changed = true;
                    if monitor
                        .requirement_id
                        .as_ref()
                        .is_some_and(|value| !value.trim().is_empty())
                    {
                        progress = progress_event(monitor, &commit);
                    } else {
                        monitor.last_acked_hash = Some(commit.hash.clone());
                    }
                }
                if monitor.status_message.is_some() {
                    monitor.status_message = None;
                    changed = true;
                }
            } else {
                let hint = "仓库还没有任何提交，将在首次提交后开始同步".to_string();
                if monitor.status_message.as_deref() != Some(hint.as_str()) {
                    monitor.status_message = Some(hint);
                    changed = true;
                }
            }
        }
    }

    if !changed {
        return Vec::new();
    }
    if let Err(err) = save_monitors(&inner.data_dir, &inner.monitors) {
        if let Some(monitor) = inner.monitors.get_mut(index) {
            monitor.status = MonitorStatus::Error;
            monitor.status_message = Some(err);
        }
    }
    let Some(monitor) = inner.monitors.get(index) else {
        return Vec::new();
    };
    let mut events = vec![Outgoing::Status(status_event(monitor))];
    if let Some(progress) = progress {
        events.push(Outgoing::Progress(progress));
    }
    events
}

fn verify_branch(
    monitor: &Monitor,
    branch: Option<&str>,
    token: Option<&str>,
) -> Result<(), String> {
    if monitor.kind.is_remote() {
        if Path::new(&monitor.local_path).join("HEAD").exists() {
            ensure_mirror(monitor, token, false)?;
        } else {
            return Ok(());
        }
    }
    read_repo(&monitor.local_path, false, branch).map(|_| ())
}

fn ensure_mirror(monitor: &Monitor, token: Option<&str>, allow_clone: bool) -> Result<(), String> {
    let dest = Path::new(&monitor.local_path);
    let branch = if monitor.follow_branch {
        None
    } else {
        monitor.branch.as_deref()
    };
    let ssh = monitor.kind == SourceKind::RemoteSsh;
    let token = if ssh { None } else { token };
    if dest.join("HEAD").exists() {
        let spec = fetch_spec(dest, token, ssh);
        return run_git(&spec, Duration::from_secs(120), branch, token.is_some())
            .map_err(|err| err.message);
    }
    if !allow_clone {
        return Err("远程仓库的本地缓存不存在，将在下次检查时重新克隆".into());
    }
    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|err| format!("无法清理未完成的克隆：{err}"))?;
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("无法创建本地缓存目录：{err}"))?;
    }
    let spec = clone_spec(&monitor.source, dest, branch, token, true);
    match run_git(&spec, Duration::from_secs(300), branch, token.is_some()) {
        Ok(()) => Ok(()),
        Err(err) if should_retry_without_filter(&err.raw) => {
            let _ = fs::remove_dir_all(dest);
            let spec = clone_spec(&monitor.source, dest, branch, token, false);
            run_git(&spec, Duration::from_secs(300), branch, token.is_some()).map_err(|retry| {
                let _ = fs::remove_dir_all(dest);
                retry.message
            })
        }
        Err(err) => {
            let _ = fs::remove_dir_all(dest);
            Err(err.message)
        }
    }
}

fn run_git(
    spec: &GitCommandSpec,
    timeout: Duration,
    branch: Option<&str>,
    had_token: bool,
) -> Result<(), GitRunError> {
    let mut command = Command::new("git");
    command.args(&spec.args);
    for (key, value) in &spec.env {
        command.env(key, value);
    }
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command.spawn().map_err(|err| {
        let message = if err.kind() == std::io::ErrorKind::NotFound {
            "未找到 Git 命令。监控远程仓库需要先安装 Git，并确保 git 在 PATH 中。".to_string()
        } else {
            format!("无法启动 Git：{err}")
        };
        GitRunError {
            message,
            raw: String::new(),
        }
    })?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_handle = thread::spawn(move || drain_capped(stdout, 8 * 1024));
    let stderr_handle = thread::spawn(move || drain_capped(stderr, 8 * 1024));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                return Err(GitRunError {
                    message: "访问远程仓库超时。请检查网络、仓库地址，以及 SSH 密钥或访问令牌。"
                        .into(),
                    raw: String::new(),
                });
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(err) => {
                return Err(GitRunError {
                    message: format!("Git 进程异常：{err}"),
                    raw: String::new(),
                });
            }
        }
    };
    let _stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();
    if status.success() {
        return Ok(());
    }
    let raw = redact(&stderr, &spec.redactions);
    let message = interpret_git_failure(&raw, branch, had_token);
    Err(GitRunError { message, raw })
}

fn install_notify(path: &str, kick: Arc<AtomicBool>) -> Result<RecommendedWatcher, String> {
    let dir = repository_git_dir(path).unwrap_or_else(|| {
        let git_dir = Path::new(path).join(".git");
        if git_dir.is_dir() {
            git_dir
        } else {
            std::path::PathBuf::from(path)
        }
    });
    let mut watcher = notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
        if let Ok(event) = result {
            if matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                kick.store(true, Ordering::Release);
            }
        }
    })
    .map_err(|err| translate_watch_error(&err.to_string()))?;
    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|err| translate_watch_error(&err.to_string()))?;
    Ok(watcher)
}

fn remember_outcome(monitor: &mut Monitor, outcome: &ReadOutcome) {
    if monitor.ownership_note.is_none() {
        monitor.ownership_note = outcome.ownership_note.clone();
    }
    if let Some(commit) = &outcome.commit {
        monitor.last_seen = Some(commit.clone());
        if monitor.follow_branch {
            monitor.current_branch = Some(commit.branch.clone());
        } else if monitor.current_branch.is_none() {
            monitor.current_branch = outcome.current_branch.clone();
        }
        if monitor.requirement_id.is_none() {
            monitor.last_acked_hash = Some(commit.hash.clone());
        }
        monitor.status_message = None;
    } else {
        monitor.current_branch = outcome.current_branch.clone();
        monitor.status_message = Some("仓库还没有任何提交，将在首次提交后开始同步".into());
    }
}

fn current_interval(inner: &Arc<Mutex<Inner>>, id: &str) -> Duration {
    let guard = lock_arc(inner);
    let Some((kind, path)) = guard
        .monitors
        .iter()
        .find(|monitor| monitor.id == id)
        .map(|monitor| (monitor.kind, monitor.local_path.clone()))
    else {
        return Duration::from_secs(5);
    };
    let notify_active = guard
        .active
        .get(id)
        .and_then(|active| active.notify.as_ref())
        .is_some();
    poll_interval(kind, &path, notify_active)
}

fn generation_is_current(inner: &Arc<Mutex<Inner>>, id: &str, generation: u64) -> bool {
    lock_arc(inner)
        .active
        .get(id)
        .map(|active| active.generation)
        == Some(generation)
}

fn emit_all(app: &AppHandle, events: Vec<Outgoing>) {
    for event in events {
        match event {
            Outgoing::Progress(progress) => {
                let _ = app.emit("git-progress", &progress);
            }
            Outgoing::Status(status) => {
                let _ = app.emit("git-monitor-status", &status);
            }
        }
    }
}

fn status_event(monitor: &Monitor) -> GitMonitorStatusEvent {
    GitMonitorStatusEvent {
        id: monitor.id.clone(),
        status: monitor.status,
        status_message: monitor.status_message.clone(),
        ownership_note: monitor.ownership_note.clone(),
        current_branch: monitor.current_branch.clone(),
        sync_error: monitor.sync_error.clone(),
    }
}

fn monitor_key(monitor: &Monitor) -> String {
    match classify_source(&monitor.source) {
        Ok(classified) => duplicate_key(&monitor.connection_id, &classified),
        Err(_) => format!("{}\n{}", monitor.connection_id, monitor.source),
    }
}

fn pick_token(field: Option<String>, embedded: Option<String>, kind: SourceKind) -> Option<String> {
    if kind != SourceKind::RemoteHttps {
        return None;
    }
    normalize_secret(field).or(normalize_secret(embedded))
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

fn new_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(1);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("m{nanos:x}{seq:x}")
}

fn lock(state: &GitWatcher) -> std::sync::MutexGuard<'_, Inner> {
    state.inner.lock().unwrap_or_else(|err| err.into_inner())
}

fn lock_arc(inner: &Arc<Mutex<Inner>>) -> std::sync::MutexGuard<'_, Inner> {
    inner.lock().unwrap_or_else(|err| err.into_inner())
}

fn hide_console(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = command;
}

fn drain_capped(stream: Option<impl Read>, cap: usize) -> String {
    let Some(mut stream) = stream else {
        return String::new();
    };
    let mut kept = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => {
                if kept.len() < cap {
                    let take = size.min(cap - kept.len());
                    kept.extend_from_slice(&buffer[..take]);
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&kept).into_owned()
}

struct ReservationGuard {
    inner: Arc<Mutex<Inner>>,
    key: String,
}

impl Drop for ReservationGuard {
    fn drop(&mut self) {
        let mut inner = lock_arc(&self.inner);
        inner.reservations.remove(&self.key);
    }
}
