//! 纯逻辑：识别仓库地址、校验、读取提交、本地持久化。
//! 访问令牌只进入独立的 secrets 文件，不能出现在监控列表、日志或发往团队服务器的数据里。

use git2::{BranchType, Repository};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const MONITORS_FILE: &str = "git-monitors.json";
const SECRETS_FILE: &str = "git-monitor-secrets.json";

static OWNER_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    Local,
    RemoteHttps,
    RemoteSsh,
}

impl SourceKind {
    pub fn is_remote(self) -> bool {
        !matches!(self, SourceKind::Local)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassifiedSource {
    pub kind: SourceKind,
    /// 展示和克隆用的地址。HTTPS 用户信息已被去掉。
    pub normalized: String,
    /// 从 URL 用户信息里拆出的令牌。调用方只能把它写入本地 secrets。
    pub embedded_token: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchStrategy {
    /// 本地普通路径，监听 .git 目录。
    Notify,
    /// 远程仓库，或 WSL 网络路径（文件系统通知不可靠）。
    Poll,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MonitorStatus {
    Watching,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub branch: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Monitor {
    pub id: String,
    pub connection_id: String,
    pub source: String,
    pub kind: SourceKind,
    pub local_path: String,
    pub follow_branch: bool,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub current_branch: Option<String>,
    #[serde(default)]
    pub requirement_id: Option<String>,
    pub status: MonitorStatus,
    #[serde(default)]
    pub status_message: Option<String>,
    #[serde(default)]
    pub ownership_note: Option<String>,
    #[serde(default)]
    pub sync_error: Option<String>,
    #[serde(default)]
    pub last_seen: Option<CommitInfo>,
    #[serde(default)]
    pub last_acked_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMonitorDto {
    pub id: String,
    pub connection_id: String,
    pub source: String,
    pub kind: SourceKind,
    pub follow_branch: bool,
    pub branch: Option<String>,
    pub current_branch: Option<String>,
    pub requirement_id: Option<String>,
    pub has_access_token: bool,
    pub status: MonitorStatus,
    pub status_message: Option<String>,
    pub ownership_note: Option<String>,
    pub sync_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSourceInspection {
    pub kind: SourceKind,
    pub normalized_source: String,
    pub current_branch: Option<String>,
    pub ownership_note: Option<String>,
    pub has_commits: bool,
}

#[derive(Debug, Clone)]
pub struct ReadOutcome {
    pub commit: Option<CommitInfo>,
    pub current_branch: Option<String>,
    pub ownership_note: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GitCommandSpec {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// 出现在子进程输出里时必须抹掉的片段（原始令牌、Base64、Authorization 头）。
    pub redactions: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct MonitorFile {
    version: u32,
    monitors: Vec<Monitor>,
}

#[derive(Serialize, Deserialize, Default)]
struct SecretFile {
    version: u32,
    tokens: HashMap<String, String>,
}

pub fn classify_source(input: &str) -> Result<ClassifiedSource, String> {
    let trimmed = trim_wrapping(input);
    if trimmed.is_empty() {
        return Err("请填写仓库路径或远程仓库地址".into());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("仓库路径或地址包含无法识别的字符".into());
    }

    let lower = trimmed.to_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        return classify_http(&trimmed);
    }
    if lower.starts_with("ssh://") || lower.starts_with("git://") {
        return classify_ssh_url(&trimmed);
    }
    if lower.starts_with("file://") {
        let path = file_url_to_path(&trimmed)?;
        return Ok(ClassifiedSource {
            kind: SourceKind::Local,
            normalized: path,
            embedded_token: None,
        });
    }
    if looks_like_scp(&trimmed) {
        return classify_scp(&trimmed);
    }
    Ok(ClassifiedSource {
        kind: SourceKind::Local,
        normalized: trimmed,
        embedded_token: None,
    })
}

/// 在真正创建文件系统监听之前决定策略。远程地址和 WSL 路径都不会走 notify。
pub fn plan_watch(input: &str) -> Result<WatchStrategy, String> {
    let classified = classify_source(input)?;
    Ok(watch_strategy(classified.kind, &classified.normalized))
}

pub fn watch_strategy(kind: SourceKind, local_path: &str) -> WatchStrategy {
    if kind.is_remote() || is_wsl_path(local_path) {
        WatchStrategy::Poll
    } else {
        WatchStrategy::Notify
    }
}

pub fn is_wsl_path(path: &str) -> bool {
    let unified = path.trim().replace('/', "\\").to_lowercase();
    let without_prefix = unified
        .strip_prefix("\\\\?\\unc\\")
        .unwrap_or(unified.as_str());
    without_prefix.starts_with("\\\\wsl$\\")
        || without_prefix.starts_with("\\\\wsl.localhost\\")
        || without_prefix.starts_with("wsl$\\")
        || without_prefix.starts_with("wsl.localhost\\")
}

pub fn poll_interval(kind: SourceKind, local_path: &str, notify_active: bool) -> Duration {
    if kind.is_remote() {
        Duration::from_secs(15)
    } else if is_wsl_path(local_path) || !notify_active {
        Duration::from_secs(2)
    } else {
        Duration::from_secs(5)
    }
}

pub fn canonical_key(source: &ClassifiedSource) -> String {
    match source.kind {
        SourceKind::Local => canonical_local(&source.normalized),
        SourceKind::RemoteHttps | SourceKind::RemoteSsh => strip_dot_git(&source.normalized),
    }
}

pub fn duplicate_key(connection_id: &str, source: &ClassifiedSource) -> String {
    format!("{}\n{}", connection_id.trim(), canonical_key(source))
}

pub fn normalize_requirement_id(raw: Option<String>) -> Option<String> {
    raw.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn normalize_branch(raw: Option<String>) -> Option<String> {
    raw.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn validate_branch_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("请填写要固定的分支名，或改回跟随当前分支".into());
    }
    let invalid = name.starts_with('-')
        || name.ends_with('/')
        || name.ends_with('.')
        || name.ends_with(".lock")
        || name.contains("..")
        || name.contains("@{")
        || name.contains("//")
        || name.chars().any(|c| {
            c.is_whitespace()
                || c.is_control()
                || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        });
    if invalid {
        return Err("分支名不合法。请填写已有分支，例如 main 或 feature/login".into());
    }
    Ok(())
}

pub fn inspect_local(path: &str) -> Result<GitSourceInspection, String> {
    ensure_local_dir(path)?;
    let (repo, note) = open_repository(Path::new(path))?;
    Ok(GitSourceInspection {
        kind: SourceKind::Local,
        normalized_source: path.trim().to_string(),
        current_branch: current_branch_name(&repo),
        ownership_note: note,
        has_commits: repo_has_commits(&repo),
    })
}

pub fn read_repo(path: &str, follow: bool, pin: Option<&str>) -> Result<ReadOutcome, String> {
    if !follow {
        validate_branch_name(pin.unwrap_or(""))?;
    }
    let (repo, note) = open_repository(Path::new(path))?;
    let current = current_branch_name(&repo);
    let commit = if follow {
        match repo.head() {
            Ok(head) => {
                let branch = head.shorthand().unwrap_or("HEAD").to_string();
                head.peel_to_commit()
                    .ok()
                    .map(|commit| commit_info(&commit, branch))
            }
            Err(_) => None,
        }
    } else {
        let branch = pin.unwrap_or("").trim();
        match find_branch_commit(&repo, branch) {
            Some(commit) => Some(commit_info(&commit, branch.to_string())),
            None => return Err(format!("仓库中找不到分支「{branch}」")),
        }
    };
    Ok(ReadOutcome {
        commit,
        current_branch: current,
        ownership_note: note,
    })
}

pub fn repository_git_dir(path: &str) -> Option<PathBuf> {
    let (repo, _) = open_repository(Path::new(path)).ok()?;
    Some(repo.path().to_path_buf())
}

pub fn translate_watch_error(err: &str) -> String {
    let lower = err.to_lowercase();
    if lower.contains("neither a file nor a directory") {
        return "路径不存在，或不是可以监听的文件夹。远程仓库请填写 https://、http://、ssh:// 或 git@ 开头的地址。".into();
    }
    if is_owner_error(&lower) {
        return ownership_note(err);
    }
    format!("无法监听该文件夹的变化，将改为定时检查。")
}

pub fn ownership_note(path: &str) -> String {
    let shown = path.replace('"', "'");
    format!(
        "Git 认为该目录所有者不可信（dubious ownership / safe.directory）。本应用会继续读取提交。若终端中的 Git 仍然失败，请执行：git config --global --add safe.directory \"{shown}\""
    )
}

pub fn redact(text: &str, secrets: &[String]) -> String {
    let mut out = text.to_string();
    let mut secrets: Vec<&str> = secrets
        .iter()
        .map(String::as_str)
        .filter(|s| s.len() >= 6)
        .collect();
    secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
    for secret in secrets {
        out = out.replace(secret, "******");
    }
    redact_url_userinfo(&out)
}

pub fn clone_spec(
    url: &str,
    dest: &Path,
    branch: Option<&str>,
    token: Option<&str>,
    blobless: bool,
) -> GitCommandSpec {
    let mut args = vec![
        "-c".to_string(),
        "safe.directory=*".to_string(),
        "clone".to_string(),
        "--bare".to_string(),
        "--no-tags".to_string(),
    ];
    if blobless {
        args.push("--filter=blob:none".to_string());
    }
    if let Some(branch) = branch {
        args.push("--branch".to_string());
        args.push(branch.to_string());
    }
    args.push("--".to_string());
    args.push(url.to_string());
    args.push(dest.display().to_string());
    with_auth(args, token, url_uses_ssh(url))
}

pub fn fetch_spec(repo: &Path, token: Option<&str>, ssh: bool) -> GitCommandSpec {
    let args = vec![
        "-C".to_string(),
        repo.display().to_string(),
        "-c".to_string(),
        "safe.directory=*".to_string(),
        "fetch".to_string(),
        "--prune".to_string(),
        "origin".to_string(),
    ];
    with_auth(args, token, ssh)
}

pub fn interpret_git_failure(stderr: &str, branch: Option<&str>, had_token: bool) -> String {
    let clean = stderr.trim();
    let lower = clean.to_lowercase();
    if is_owner_error(&lower) {
        return "Git 拒绝读取该仓库：目录所有者不可信（dubious ownership）。请在本机执行 git config --global --add safe.directory \"<仓库路径>\" 后重试。".into();
    }
    if is_auth_failure(&lower) {
        return "无法访问该远程仓库。请确认地址正确；私有仓库请使用已配置的 SSH 密钥或 Git 凭证，或填写只保存在本机的访问令牌。".into();
    }
    if lower.contains("repository not found")
        || (lower.contains("not found") && lower.contains("could not read from remote"))
    {
        if had_token {
            return "找不到该远程仓库，或访问令牌没有权限。请检查地址和令牌。".into();
        }
        return "找不到该远程仓库，或没有访问权限。公开仓库请检查地址；私有仓库请配置 SSH 密钥 / Git 凭证，或填写只保存在本机的访问令牌。".into();
    }
    if let Some(branch) = branch {
        let branch_lower = branch.to_lowercase();
        if (lower.contains("remote branch") && lower.contains("not found"))
            || lower.contains(&format!("couldn't find remote ref {branch_lower}"))
            || lower.contains("not found in upstream")
        {
            return format!("远程仓库中找不到分支「{branch}」");
        }
    }
    if lower.contains("not a git repository") {
        return "该文件夹不是 Git 仓库（未找到 .git）".into();
    }
    let snippet = clean
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();
    if snippet.is_empty() {
        "Git 命令执行失败".into()
    } else {
        format!("Git 命令执行失败：{snippet}")
    }
}

pub fn should_retry_without_filter(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("filter") || lower.contains("promisor") || lower.contains("not supported")
}

pub fn load_monitors(dir: &Path) -> Result<Vec<Monitor>, String> {
    let path = dir.join(MONITORS_FILE);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("无法读取监控配置：{e}"))?;
    let file: MonitorFile = serde_json::from_str(&text).map_err(|_| {
        "监控配置文件已损坏，未能加载。请检查应用数据目录中的 git-monitors.json".to_string()
    })?;
    Ok(file.monitors)
}

pub fn load_secrets(dir: &Path) -> Result<HashMap<String, String>, String> {
    let path = dir.join(SECRETS_FILE);
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("无法读取本地凭证：{e}"))?;
    let file: SecretFile = serde_json::from_str(&text)
        .map_err(|_| "本地访问令牌文件已损坏，本次未加载令牌。".to_string())?;
    Ok(file.tokens)
}

pub fn save_monitors(dir: &Path, monitors: &[Monitor]) -> Result<(), String> {
    write_private_json(
        &dir.join(MONITORS_FILE),
        &MonitorFile {
            version: 1,
            monitors: monitors.to_vec(),
        },
    )
}

pub fn save_secrets(dir: &Path, tokens: &HashMap<String, String>) -> Result<(), String> {
    write_private_json(
        &dir.join(SECRETS_FILE),
        &SecretFile {
            version: 1,
            tokens: tokens.clone(),
        },
    )
}

pub fn mirror_dir(data_dir: &Path, id: &str) -> PathBuf {
    data_dir.join("git-mirrors").join(id)
}

pub fn progress_event(monitor: &Monitor, commit: &CommitInfo) -> Option<GitProgressEvent> {
    let requirement_id = monitor.requirement_id.clone()?;
    if requirement_id.trim().is_empty() {
        return None;
    }
    Some(GitProgressEvent {
        repo_id: monitor.id.clone(),
        connection_id: monitor.connection_id.clone(),
        repo_path: monitor.source.clone(),
        branch: commit.branch.clone(),
        commit_hash: commit.hash.clone(),
        commit_message: commit.message.clone(),
        author: commit.author.clone(),
        timestamp: commit.timestamp,
        requirement_id: Some(requirement_id),
    })
}

pub fn to_dto(monitor: &Monitor, has_access_token: bool) -> GitMonitorDto {
    GitMonitorDto {
        id: monitor.id.clone(),
        connection_id: monitor.connection_id.clone(),
        source: monitor.source.clone(),
        kind: monitor.kind,
        follow_branch: monitor.follow_branch,
        branch: monitor.branch.clone(),
        current_branch: monitor.current_branch.clone(),
        requirement_id: monitor.requirement_id.clone(),
        has_access_token,
        status: monitor.status,
        status_message: monitor.status_message.clone(),
        ownership_note: monitor.ownership_note.clone(),
        sync_error: monitor.sync_error.clone(),
    }
}

fn classify_http(raw: &str) -> Result<ClassifiedSource, String> {
    if raw.contains(char::is_whitespace) {
        return Err("远程仓库地址不能包含空格".into());
    }
    let scheme_end = raw
        .find("://")
        .ok_or_else(|| "远程仓库地址无效".to_string())?;
    let scheme = raw[..scheme_end].to_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err("不支持该协议。请使用 https://、http://、ssh:// 或 git@ 开头的地址".into());
    }
    let rest = &raw[scheme_end + 3..];
    if rest.is_empty() {
        return Err("远程仓库地址不完整。请填写类似 https://github.com/owner/repo 的地址".into());
    }
    let (userinfo, hostpath) = split_userinfo(rest)?;
    let (host, path) = split_host_and_path(hostpath)?;
    let token = token_from_userinfo(userinfo);
    let normalized = format!(
        "{scheme}://{}{}",
        host.to_lowercase(),
        normalize_repo_path(path)
    );
    if authority_has_userinfo(&normalized) {
        return Err("远程仓库地址无效".into());
    }
    Ok(ClassifiedSource {
        kind: SourceKind::RemoteHttps,
        normalized,
        embedded_token: token,
    })
}

fn classify_ssh_url(raw: &str) -> Result<ClassifiedSource, String> {
    if raw.contains(char::is_whitespace) {
        return Err("远程仓库地址不能包含空格".into());
    }
    let scheme_end = raw
        .find("://")
        .ok_or_else(|| "远程仓库地址无效".to_string())?;
    let scheme = raw[..scheme_end].to_lowercase();
    if scheme != "ssh" && scheme != "git" {
        return Err("不支持该协议。请使用 https://、http://、ssh:// 或 git@ 开头的地址".into());
    }
    let rest = &raw[scheme_end + 3..];
    let (userinfo, hostpath) = split_userinfo(rest)?;
    let (host, path) = split_host_and_path(hostpath)?;
    let user = userinfo
        .split_once(':')
        .map(|(user, _)| user)
        .unwrap_or(userinfo);
    let auth = if user.is_empty() {
        String::new()
    } else {
        format!("{user}@")
    };
    let normalized = format!(
        "{scheme}://{auth}{}{}",
        host.to_lowercase(),
        normalize_repo_path(path)
    );
    Ok(ClassifiedSource {
        kind: SourceKind::RemoteSsh,
        normalized,
        embedded_token: None,
    })
}

fn classify_scp(raw: &str) -> Result<ClassifiedSource, String> {
    if raw.contains(char::is_whitespace) {
        return Err("远程仓库地址不能包含空格".into());
    }
    let Some((user_host, path)) = raw.split_once(':') else {
        return Err("远程仓库地址无效。SSH 地址请使用 git@host:owner/repo.git".into());
    };
    let Some((user, host)) = user_host.rsplit_once('@') else {
        return Err(
            "远程仓库地址无效。SSH 地址请使用 git@host:owner/repo.git 或 ssh:// 形式".into(),
        );
    };
    if user.is_empty() || host.is_empty() || path.trim_matches('/').is_empty() {
        return Err("远程仓库地址不完整。SSH 地址请使用 git@host:owner/repo.git".into());
    }
    Ok(ClassifiedSource {
        kind: SourceKind::RemoteSsh,
        normalized: format!("{user}@{}:{}", host.to_lowercase(), path.trim_matches('/')),
        embedded_token: None,
    })
}

fn looks_like_scp(value: &str) -> bool {
    if value.contains("://") || value.contains('\\') {
        return false;
    }
    let bytes = value.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return false;
    }
    let Some((user_host, path)) = value.split_once(':') else {
        return false;
    };
    !user_host.is_empty() && !path.is_empty() && user_host.contains('@')
}

fn file_url_to_path(url: &str) -> Result<String, String> {
    let Some((_, rest)) = url.split_once("://") else {
        return Err("file:// 地址无效".into());
    };
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    if rest.is_empty() || rest == "/" {
        return Err("file:// 地址无效".into());
    }
    if rest.len() >= 3 && rest.as_bytes()[0] == b'/' && rest.as_bytes()[2] == b':' {
        return Ok(rest[1..].to_string());
    }
    Ok(rest.to_string())
}

fn split_userinfo(rest: &str) -> Result<(&str, &str), String> {
    let path_start = rest.find('/').unwrap_or(rest.len());
    let authority = &rest[..path_start];
    if let Some(at) = authority.rfind('@') {
        let host = &authority[at + 1..];
        if host.is_empty() {
            return Err("远程仓库地址无效".into());
        }
        Ok((&authority[..at], &rest[at + 1..]))
    } else {
        Ok(("", rest))
    }
}

fn split_host_and_path(hostpath: &str) -> Result<(&str, &str), String> {
    let Some(slash) = hostpath.find('/') else {
        return Err(
            "远程仓库地址不完整。需要包含主机名和仓库路径，例如 https://github.com/owner/repo"
                .into(),
        );
    };
    let host = &hostpath[..slash];
    let path = &hostpath[slash..];
    if host.is_empty() || path.trim_matches('/').is_empty() {
        return Err(
            "远程仓库地址不完整。需要包含主机名和仓库路径，例如 https://github.com/owner/repo"
                .into(),
        );
    }
    Ok((host, path))
}

fn normalize_repo_path(path: &str) -> String {
    let path = path.split(['?', '#']).next().unwrap_or(path);
    let mut cleaned = path.trim_end_matches('/').to_string();
    if !cleaned.starts_with('/') {
        cleaned.insert(0, '/');
    }
    cleaned
}

fn token_from_userinfo(userinfo: &str) -> Option<String> {
    if userinfo.is_empty() {
        return None;
    }
    let decoded = percent_decode(userinfo);
    let token = decoded
        .split_once(':')
        .map(|(_, password)| password.to_string())
        .unwrap_or(decoded);
    let token = token.trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

fn authority_has_userinfo(url: &str) -> bool {
    let Some((_, rest)) = url.split_once("://") else {
        return false;
    };
    rest.split('/').next().unwrap_or(rest).contains('@')
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(
                std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""),
                16,
            ) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn canonical_local(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches(['/', '\\']);
    if is_wsl_path(trimmed) {
        return trimmed.replace('/', "\\").to_lowercase();
    }
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return trimmed.replace('/', "\\").to_lowercase();
    }
    trimmed.to_string()
}

fn strip_dot_git(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.to_lowercase().ends_with(".git") {
        trimmed[..trimmed.len() - 4].to_string()
    } else {
        trimmed.to_string()
    }
}

fn trim_wrapping(input: &str) -> String {
    let trimmed = input.trim();
    let mut chars = trimmed.chars();
    let first = chars.next();
    let last = trimmed.chars().next_back();
    if matches!(
        (first, last),
        (Some('"'), Some('"')) | (Some('\''), Some('\''))
    ) && trimmed.len() >= 2
    {
        trimmed[1..trimmed.len() - 1].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn ensure_local_dir(path: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("请填写仓库路径或远程仓库地址".into());
    }
    let file = Path::new(path);
    if !file.exists() {
        if is_wsl_path(path) {
            return Err("找不到该 WSL 路径。请确认发行版名称和目录，例如 \\\\wsl$\\Ubuntu\\home\\用户名\\项目，或 \\\\wsl.localhost\\Ubuntu\\...".into());
        }
        return Err("找不到该路径。请确认文件夹存在，或点击「选择文件夹」。WSL 仓库请使用 \\\\wsl$\\发行版\\... 或 \\\\wsl.localhost\\发行版\\...".into());
    }
    if !file.is_dir() {
        return Err("请选择 Git 仓库所在的文件夹，而不是文件".into());
    }
    Ok(())
}

fn open_repository(path: &Path) -> Result<(Repository, Option<String>), String> {
    let display = path.to_string_lossy();
    match Repository::open(path) {
        Ok(repo) => Ok((repo, None)),
        Err(err) => {
            let message = err.to_string();
            if !is_owner_error(&message) {
                return Err(map_open_error(&display, &message));
            }
            let note = ownership_note(&display);
            let _guard = OWNER_LOCK.lock().unwrap_or_else(|err| err.into_inner());
            // 只在这一次打开期间关闭所有者校验，避免 WSL 路径被 dubious ownership 拦住。
            // 调用本身不会失败；失败时退回明确的 safe.directory 提示。
            if unsafe { git2::opts::set_verify_owner_validation(false) }.is_err() {
                return Err(note);
            }
            let opened = Repository::open(path);
            let _ = unsafe { git2::opts::set_verify_owner_validation(true) };
            match opened {
                Ok(repo) => Ok((repo, Some(note))),
                Err(err) => Err(map_open_error(&display, &err.to_string())),
            }
        }
    }
}

pub fn is_owner_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("dubious ownership")
        || lower.contains("safe.directory")
        || lower.contains("not owned by current user")
        || lower.contains("is not owned by")
}

fn map_open_error(path: &str, message: &str) -> String {
    if is_owner_error(message) {
        return ownership_note(path);
    }
    let lower = message.to_lowercase();
    if lower.contains("not found")
        || lower.contains("no such file")
        || lower.contains("failed to resolve")
        || lower.contains("not a git repository")
        || lower.contains("could not find repository")
    {
        return "该文件夹不是 Git 仓库（未找到 .git）".into();
    }
    format!("无法读取 Git 仓库：{}", redact(message, &[]))
}

fn current_branch_name(repo: &Repository) -> Option<String> {
    if let Ok(head) = repo.head() {
        if let Some(name) = head.shorthand() {
            return Some(name.to_string());
        }
    }
    let head = repo.find_reference("HEAD").ok()?;
    let target = head.symbolic_target()?;
    Some(
        target
            .strip_prefix("refs/heads/")
            .unwrap_or(target)
            .to_string(),
    )
}

fn repo_has_commits(repo: &Repository) -> bool {
    repo.head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok())
        .is_some()
}

fn find_branch_commit<'repo>(repo: &'repo Repository, name: &str) -> Option<git2::Commit<'repo>> {
    if let Ok(branch) = repo.find_branch(name, BranchType::Local) {
        if let Some(commit) = branch.get().peel_to_commit().ok() {
            return Some(commit);
        }
    }
    let candidates = [
        format!("refs/heads/{name}"),
        format!("refs/remotes/origin/{name}"),
        format!("refs/remotes/{name}"),
    ];
    for candidate in candidates {
        if let Ok(reference) = repo.find_reference(&candidate) {
            if let Ok(commit) = reference.peel_to_commit() {
                return Some(commit);
            }
        }
    }
    None
}

fn commit_info(commit: &git2::Commit, branch: String) -> CommitInfo {
    let mut message = commit.message().unwrap_or("").trim().to_string();
    if message.chars().count() > 2000 {
        message = message.chars().take(2000).collect();
    }
    if message.is_empty() {
        message = "（无提交说明）".into();
    }
    CommitInfo {
        hash: commit.id().to_string(),
        branch,
        message,
        author: commit.author().name().unwrap_or("unknown").to_string(),
        timestamp: commit.time().seconds(),
    }
}

fn with_auth(args: Vec<String>, token: Option<&str>, ssh: bool) -> GitCommandSpec {
    let mut env = Vec::new();
    let mut redactions = Vec::new();
    if ssh {
        env.push(("GIT_SSH_COMMAND".into(), "ssh -o BatchMode=yes".into()));
    }
    if let Some(token) = token
        .map(str::trim)
        .filter(|token| !token.is_empty() && !ssh)
    {
        let header = basic_header(token);
        env.push(("GIT_CONFIG_COUNT".into(), "2".into()));
        env.push(("GIT_CONFIG_KEY_0".into(), "http.extraheader".into()));
        env.push(("GIT_CONFIG_VALUE_0".into(), header.clone()));
        env.push(("GIT_CONFIG_KEY_1".into(), "credential.helper".into()));
        env.push(("GIT_CONFIG_VALUE_1".into(), String::new()));
        redactions.push(token.to_string());
        redactions.push(base64_encode(token.as_bytes()));
        redactions.push(base64_encode(format!("oauth2:{token}").as_bytes()));
        redactions.push(header);
    }
    GitCommandSpec {
        args,
        env,
        redactions,
    }
}

fn url_uses_ssh(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.starts_with("ssh://") || lower.starts_with("git@") || looks_like_scp(url)
}

fn basic_header(token: &str) -> String {
    format!(
        "Authorization: Basic {}",
        base64_encode(format!("oauth2:{token}").as_bytes())
    )
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut index = 0;
    while index + 3 <= data.len() {
        let chunk =
            ((data[index] as u32) << 16) | ((data[index + 1] as u32) << 8) | data[index + 2] as u32;
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 6) & 63) as usize] as char);
        out.push(TABLE[(chunk & 63) as usize] as char);
        index += 3;
    }
    let rest = data.len() - index;
    if rest == 1 {
        let chunk = (data[index] as u32) << 16;
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rest == 2 {
        let chunk = ((data[index] as u32) << 16) | ((data[index + 1] as u32) << 8);
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

fn is_auth_failure(lower: &str) -> bool {
    lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("permission denied")
        || lower.contains("invalid username or token")
        || lower.contains("terminal prompts disabled")
        || lower.contains("authentication required")
        || lower.contains("support for password authentication was removed")
}

fn redact_url_userinfo(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find("://") {
        let after = index + 3;
        result.push_str(&rest[..after]);
        let tail = &rest[after..];
        let end = tail.find(char::is_whitespace).unwrap_or(tail.len());
        let segment = &tail[..end];
        if let Some(at) = segment.find('@') {
            let before = &segment[..at];
            if !before.is_empty() && !before.contains('/') {
                result.push_str("******");
                result.push_str(&segment[at..]);
            } else {
                result.push_str(segment);
            }
        } else {
            result.push_str(segment);
        }
        rest = &tail[end..];
    }
    result.push_str(rest);
    result
}

fn write_private_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{e}"))?;
    }
    let data = serde_json::to_vec_pretty(value).map_err(|e| format!("无法序列化监控配置：{e}"))?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &data).map_err(|e| format!("无法写入监控配置：{e}"))?;
    set_private(&tmp);
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path).map_err(|e| format!("无法保存监控配置：{e}"))?;
    set_private(path);
    Ok(())
}

fn set_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn github_url_is_remote_and_never_uses_notify() {
        let classified = classify_source("https://github.com/ncwtf/gteam").unwrap();
        assert_eq!(classified.kind, SourceKind::RemoteHttps);
        assert_eq!(classified.normalized, "https://github.com/ncwtf/gteam");
        assert!(classified.embedded_token.is_none());
        assert_eq!(
            plan_watch("https://github.com/ncwtf/gteam").unwrap(),
            WatchStrategy::Poll
        );
    }

    #[test]
    fn rejects_incomplete_urls_before_any_watch_plan() {
        assert!(plan_watch("").unwrap_err().contains("请填写"));
        assert!(plan_watch("   ").is_err());
        assert!(plan_watch("https://").unwrap_err().contains("不完整"));
        assert!(plan_watch("https://github.com")
            .unwrap_err()
            .contains("不完整"));
        assert!(plan_watch("https://github.com/").is_err());
    }

    #[test]
    fn strips_embedded_https_credentials() {
        let classified =
            classify_source("https://user:ghp_supersecret@github.com/ncwtf/gteam.git").unwrap();
        assert_eq!(
            classified.embedded_token.as_deref(),
            Some("ghp_supersecret")
        );
        assert_eq!(classified.normalized, "https://github.com/ncwtf/gteam.git");
        assert!(!classified.normalized.contains("ghp_supersecret"));
        assert!(!classified.normalized.contains("user"));
    }

    #[test]
    fn percent_encoded_token_is_decoded_and_removed_from_url() {
        let classified = classify_source("https://user:my%40token@github.com/acme/repo").unwrap();
        assert_eq!(classified.embedded_token.as_deref(), Some("my@token"));
        assert!(!classified.normalized.contains("my"));
    }

    #[test]
    fn ssh_and_scp_urls_are_remote() {
        let scp = classify_source("git@github.com:ncwtf/gteam.git").unwrap();
        assert_eq!(scp.kind, SourceKind::RemoteSsh);
        assert_eq!(scp.normalized, "git@github.com:ncwtf/gteam.git");
        assert_eq!(
            plan_watch("git@github.com:ncwtf/gteam.git").unwrap(),
            WatchStrategy::Poll
        );

        let ssh = classify_source("ssh://git@GitHub.com:2222/ncwtf/gteam.git").unwrap();
        assert_eq!(ssh.kind, SourceKind::RemoteSsh);
        assert_eq!(ssh.normalized, "ssh://git@github.com:2222/ncwtf/gteam.git");
        assert!(ssh.embedded_token.is_none());
    }

    #[test]
    fn same_remote_with_or_without_git_suffix_is_one_repo() {
        let a = classify_source("https://github.com/ncwtf/gteam").unwrap();
        let b = classify_source("https://GitHub.com/ncwtf/gteam.git/").unwrap();
        assert_eq!(canonical_key(&a), canonical_key(&b));
    }

    #[test]
    fn local_paths_and_windows_drives_stay_local() {
        let drive = classify_source(r"C:\src\gteam").unwrap();
        assert_eq!(drive.kind, SourceKind::Local);
        assert_eq!(plan_watch(r"C:\src\gteam").unwrap(), WatchStrategy::Notify);
        let unix = classify_source("/home/me/proj").unwrap();
        assert_eq!(unix.kind, SourceKind::Local);
        assert_eq!(
            watch_strategy(unix.kind, &unix.normalized),
            WatchStrategy::Notify
        );
    }

    #[test]
    fn wsl_unc_paths_always_poll() {
        for path in [
            r"\\wsl$\Ubuntu\home\me\proj",
            r"\\wsl.localhost\Ubuntu\home\me\proj",
            "//wsl$/Ubuntu/home/me/proj",
            "//wsl.localhost/Debian/home/me/proj",
            r"\\WSL$\ubuntu\home\me\proj",
            r"\\?\UNC\wsl$\Ubuntu\home\me\proj",
        ] {
            assert!(is_wsl_path(path), "{path}");
            let classified = classify_source(path).unwrap();
            assert_eq!(classified.kind, SourceKind::Local);
            assert_eq!(watch_strategy(classified.kind, path), WatchStrategy::Poll);
        }
        assert!(!is_wsl_path(r"C:\src\proj"));
        assert!(!is_wsl_path("/home/me/proj"));
        assert!(!is_wsl_path(r"\\server\share\repo"));
    }

    #[test]
    fn wsl_poll_interval_is_short_and_remote_is_slower() {
        assert_eq!(
            poll_interval(SourceKind::Local, r"\\wsl$\Ubuntu\repo", true),
            Duration::from_secs(2)
        );
        assert_eq!(
            poll_interval(SourceKind::RemoteHttps, "/cache/repo", false),
            Duration::from_secs(15)
        );
        assert_eq!(
            poll_interval(SourceKind::Local, "/home/me/repo", true),
            Duration::from_secs(5)
        );
        assert_eq!(
            poll_interval(SourceKind::Local, "/home/me/repo", false),
            Duration::from_secs(2)
        );
    }

    #[test]
    fn file_urls_become_local_paths() {
        assert_eq!(
            classify_source("file:///home/me/repo").unwrap().normalized,
            "/home/me/repo"
        );
        assert_eq!(
            classify_source("file:///C:/src/repo").unwrap().normalized,
            "C:/src/repo"
        );
    }

    #[test]
    fn quoted_input_is_unwrapped() {
        let classified = classify_source("\"https://github.com/ncwtf/gteam\"").unwrap();
        assert_eq!(classified.normalized, "https://github.com/ncwtf/gteam");
    }

    #[test]
    fn requirement_id_blank_is_optional() {
        assert_eq!(normalize_requirement_id(None), None);
        assert_eq!(normalize_requirement_id(Some("  ".into())), None);
        assert_eq!(
            normalize_requirement_id(Some(" abc ".into())),
            Some("abc".into())
        );
    }

    #[test]
    fn branch_names_are_validated() {
        assert!(validate_branch_name("main").is_ok());
        assert!(validate_branch_name("feature/login").is_ok());
        assert!(validate_branch_name("").unwrap_err().contains("分支"));
        assert!(validate_branch_name("-bad").is_err());
        assert!(validate_branch_name("has space").is_err());
    }

    #[test]
    fn notify_english_error_becomes_chinese() {
        let message = translate_watch_error(
            "Failed to watch path: Input watch path is neither a file nor a directory.",
        );
        assert!(message.contains("远程"));
        assert!(!message.to_lowercase().contains("failed to watch"));
    }

    #[test]
    fn ownership_error_mentions_safe_directory() {
        let message = map_open_error(
            r"\\wsl$\Ubuntu\home\me\app",
            "repository path '\\\\wsl$\\Ubuntu\\home\\me\\app' is not owned by current user",
        );
        assert!(message.contains("safe.directory"));
        assert!(message.contains("dubious ownership"));
        assert!(message.contains(r"\\wsl$\Ubuntu\home\me\app") || message.contains("wsl$"));
    }

    #[test]
    fn git_auth_failure_is_chinese_and_token_is_removed() {
        let stderr = "fatal: Authentication failed for 'https://user:ghp_supersecret@github.com/acme/repo.git/'";
        let clean = redact(stderr, &["ghp_supersecret".into()]);
        assert!(!clean.contains("ghp_supersecret"));
        assert!(clean.contains("******"));
        let message = interpret_git_failure(&clean, None, true);
        assert!(message.contains("访问令牌") || message.contains("SSH"));
        assert!(!message.contains("ghp_supersecret"));
    }

    #[test]
    fn missing_remote_branch_is_chinese() {
        let message = interpret_git_failure(
            "fatal: Remote branch feature/missing not found in upstream origin",
            Some("feature/missing"),
            false,
        );
        assert!(message.contains("找不到分支"));
        assert!(message.contains("feature/missing"));
    }

    #[test]
    fn clone_args_do_not_contain_the_token() {
        let spec = clone_spec(
            "https://github.com/ncwtf/gteam",
            Path::new("/tmp/mirror"),
            Some("main"),
            Some("ghp_supersecret"),
            true,
        );
        let joined = spec.args.join(" ");
        assert!(joined.contains("https://github.com/ncwtf/gteam"));
        assert!(joined.contains("--branch"));
        assert!(joined.contains("main"));
        assert!(!joined.contains("ghp_supersecret"));
        assert!(spec
            .redactions
            .iter()
            .any(|value| value == "ghp_supersecret"));
        assert!(spec.env.iter().all(|(key, value)| {
            !key.contains("ghp_supersecret") && !value.contains("ghp_supersecret")
        }));
        let encoded = base64_encode(b"oauth2:ghp_supersecret");
        assert!(spec.env.iter().any(|(_, value)| value.contains(&encoded)));
    }

    #[test]
    fn ssh_clone_does_not_attach_http_token() {
        let spec = clone_spec(
            "git@github.com:ncwtf/gteam.git",
            Path::new("/tmp/mirror"),
            None,
            Some("ghp_supersecret"),
            false,
        );
        assert!(spec.env.iter().any(|(key, _)| key == "GIT_SSH_COMMAND"));
        assert!(spec
            .env
            .iter()
            .all(|(_, value)| !value.contains("ghp_supersecret")));
        assert!(spec.redactions.is_empty());
    }

    #[test]
    fn base64_matches_known_vector() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b"hello!"), "aGVsbG8h");
        assert_eq!(base64_encode(b"hell"), "aGVsbA==");
    }

    #[test]
    fn secrets_are_not_written_into_the_monitor_file() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("gteam-monitors-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        let token = "ghp_supersecret_local_only".to_string();
        let monitor = Monitor {
            id: "m1".into(),
            connection_id: "team-1".into(),
            source: "https://github.com/ncwtf/gteam".into(),
            kind: SourceKind::RemoteHttps,
            local_path: dir.join("mirror").display().to_string(),
            follow_branch: true,
            branch: None,
            current_branch: Some("main".into()),
            requirement_id: None,
            status: MonitorStatus::Watching,
            status_message: None,
            ownership_note: None,
            sync_error: None,
            last_seen: None,
            last_acked_hash: None,
        };
        let mut secrets = HashMap::new();
        secrets.insert(monitor.id.clone(), token.clone());
        save_monitors(&dir, &[monitor.clone()]).unwrap();
        save_secrets(&dir, &secrets).unwrap();

        let monitors_body = fs::read_to_string(dir.join("git-monitors.json")).unwrap();
        let secrets_body = fs::read_to_string(dir.join("git-monitor-secrets.json")).unwrap();
        assert!(!monitors_body.contains(&token));
        assert!(secrets_body.contains(&token));
        let loaded = load_monitors(&dir).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].source, monitor.source);
        assert!(loaded[0].requirement_id.is_none());
        assert_eq!(load_secrets(&dir).unwrap().get("m1"), Some(&token));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.join("git-monitor-secrets.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn inspects_a_real_git_repo_and_rejects_a_plain_folder() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let repo_dir = std::env::temp_dir().join(format!("gteam-repo-{nanos}"));
        let plain_dir = std::env::temp_dir().join(format!("gteam-plain-{nanos}"));
        let _ = fs::remove_dir_all(&repo_dir);
        let _ = fs::remove_dir_all(&plain_dir);
        fs::create_dir_all(&repo_dir).unwrap();
        fs::create_dir_all(&plain_dir).unwrap();

        let repo = Repository::init(&repo_dir).unwrap();
        let signature = git2::Signature::now("Tester", "tester@example.com").unwrap();
        let mut index = repo.index().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
            .unwrap();
        drop(tree);
        drop(index);
        drop(repo);

        let path = repo_dir.to_str().unwrap();
        let inspection = inspect_local(path).unwrap();
        assert_eq!(inspection.kind, SourceKind::Local);
        assert!(inspection.has_commits);
        let branch = inspection.current_branch.clone().unwrap();
        assert!(!branch.is_empty());

        let outcome = read_repo(path, true, None).unwrap();
        let commit = outcome.commit.unwrap();
        assert_eq!(commit.message, "init");
        assert_eq!(commit.hash.len(), 40);
        assert!(read_repo(path, false, Some(&branch)).is_ok());
        assert!(read_repo(path, false, Some("missing-branch"))
            .unwrap_err()
            .contains("找不到分支"));

        let plain = inspect_local(plain_dir.to_str().unwrap()).unwrap_err();
        assert!(plain.contains("不是 Git 仓库"));
        let missing = inspect_local(repo_dir.join("nope").to_str().unwrap()).unwrap_err();
        assert!(missing.contains("找不到"));

        let _ = fs::remove_dir_all(&repo_dir);
        let _ = fs::remove_dir_all(&plain_dir);
    }

    #[test]
    fn progress_event_uses_the_source_and_skips_empty_requirement() {
        let mut monitor = sample_monitor();
        monitor.requirement_id = None;
        let commit = sample_commit();
        assert!(progress_event(&monitor, &commit).is_none());
        monitor.requirement_id = Some("req-1".into());
        let event = progress_event(&monitor, &commit).unwrap();
        assert_eq!(event.repo_path, "https://github.com/ncwtf/gteam");
        assert_eq!(event.requirement_id.as_deref(), Some("req-1"));
        assert_eq!(event.commit_hash, commit.hash);
    }

    fn sample_monitor() -> Monitor {
        Monitor {
            id: "m1".into(),
            connection_id: "team".into(),
            source: "https://github.com/ncwtf/gteam".into(),
            kind: SourceKind::RemoteHttps,
            local_path: "/tmp/mirror".into(),
            follow_branch: true,
            branch: None,
            current_branch: Some("main".into()),
            requirement_id: None,
            status: MonitorStatus::Watching,
            status_message: None,
            ownership_note: None,
            sync_error: None,
            last_seen: None,
            last_acked_hash: None,
        }
    }

    fn sample_commit() -> CommitInfo {
        CommitInfo {
            hash: "a".repeat(40),
            branch: "main".into(),
            message: "hello".into(),
            author: "Tester".into(),
            timestamp: 1,
        }
    }
}
