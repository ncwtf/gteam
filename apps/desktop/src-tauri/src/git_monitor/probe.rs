//! 读取一次提交。本地仓库用 libgit2；远程和 WSL 用系统 git。
//! 令牌只通过环境变量传给 git，不放进命令行参数。

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use git2::Repository;

use super::classify::{
    basic_auth_header, credential_user_pass, is_http_url, map_cli_failure, map_git2_message,
    ErrorContext,
};
use super::store::{BranchMode, RepoTarget};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);

pub struct ProbeRequest {
    pub target: RepoTarget,
    pub branch_mode: BranchMode,
    pub token: Option<String>,
    pub mirror_dir: Option<PathBuf>,
    pub previous_hash: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitInfo {
    pub hash: String,
    pub branch: String,
    pub subject: String,
    pub author: String,
    pub timestamp: i64,
    pub sparse: bool,
}

struct Captured {
    status_ok: bool,
    stdout: String,
    stderr: String,
}

pub fn probe(request: ProbeRequest) -> Result<(CommitInfo, RepoTarget), String> {
    match request.target {
        RepoTarget::Local { path } => probe_local(&path, &request.branch_mode),
        RepoTarget::Wsl {
            distro,
            linux_path,
            display_path,
        } => probe_wsl(&distro, &linux_path, &display_path, &request.branch_mode),
        RepoTarget::Remote { url } => probe_remote(
            &url,
            &request.branch_mode,
            request.token.as_deref(),
            request.mirror_dir.as_deref(),
            request.previous_hash.as_deref(),
        ),
    }
}

fn probe_local(path: &str, mode: &BranchMode) -> Result<(CommitInfo, RepoTarget), String> {
    let repo = Repository::discover(path).map_err(|err| map_git2_message(err.message(), path))?;
    let root = repo
        .workdir()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(path));
    let mut display = root.to_string_lossy().trim_end_matches(['/', '\\']).to_string();
    if let Some(stripped) = display.strip_prefix(r"\\?\UNC\") {
        display = format!(r"\\{stripped}");
    } else if let Some(stripped) = display.strip_prefix(r"\\?\") {
        display = stripped.to_string();
    }
    if display.is_empty() {
        display = path.to_string();
    }
    let info = read_local_commit(&repo, mode, &display)?;
    Ok((
        info,
        RepoTarget::Local {
            path: display,
        },
    ))
}

fn read_local_commit(repo: &Repository, mode: &BranchMode, path_hint: &str) -> Result<CommitInfo, String> {
    match mode {
        BranchMode::Follow => {
            let head = repo.head().map_err(|err| {
                if err.code() == git2::ErrorCode::UnbornBranch {
                    "仓库还没有任何提交。请先创建一次提交后再添加监控。".to_string()
                } else {
                    map_git2_message(err.message(), path_hint)
                }
            })?;
            let branch = if head.is_branch() {
                head.shorthand().unwrap_or("HEAD").to_string()
            } else {
                "HEAD（游离）".to_string()
            };
            let commit = head
                .peel_to_commit()
                .map_err(|err| map_git2_message(err.message(), path_hint))?;
            Ok(commit_from_git2(&commit, branch))
        }
        BranchMode::Pin { name } => {
            let found = repo.find_branch(name, git2::BranchType::Local).map_err(|_| {
                format!("仓库中不存在分支「{name}」。可改为「跟随当前分支」，或填写一个已存在的本地分支。")
            })?;
            let commit = found
                .get()
                .peel_to_commit()
                .map_err(|err| map_git2_message(err.message(), path_hint))?;
            Ok(commit_from_git2(&commit, name.clone()))
        }
    }
}

fn commit_from_git2(commit: &git2::Commit<'_>, branch: String) -> CommitInfo {
    let subject = commit.summary().unwrap_or("").trim().to_string();
    let author = commit.author().name().unwrap_or("unknown").to_string();
    CommitInfo {
        hash: commit.id().to_string(),
        branch,
        subject: truncate_chars(&subject, 500),
        author,
        timestamp: commit.time().seconds(),
        sparse: false,
    }
}

fn probe_wsl(
    distro: &str,
    linux_path: &str,
    display_path: &str,
    mode: &BranchMode,
) -> Result<(CommitInfo, RepoTarget), String> {
    #[cfg(not(windows))]
    {
        let _ = (distro, linux_path, display_path, mode);
        Err("WSL 路径仅支持在 Windows 上使用。".into())
    }
    #[cfg(windows)]
    {
        let inside = wsl_git(distro, linux_path, &["rev-parse", "--is-inside-work-tree"], display_path)?;
        if inside.trim() != "true" {
            return Err(format!("该路径不是 Git 仓库（未找到 .git）：{display_path}"));
        }
        let toplevel = wsl_git(distro, linux_path, &["rev-parse", "--show-toplevel"], display_path)?;
        let toplevel = toplevel.trim().to_string();
        if !toplevel.starts_with('/') {
            return Err(format!("无法解析 WSL 仓库位置：{display_path}"));
        }
        let info = read_wsl_commit(distro, &toplevel, mode, display_path)?;
        let display = wsl_display_path(distro, &toplevel, display_path);
        Ok((
            info,
            RepoTarget::Wsl {
                distro: distro.to_string(),
                linux_path: toplevel,
                display_path: display,
            },
        ))
    }
}

#[cfg(windows)]
fn read_wsl_commit(
    distro: &str,
    linux_path: &str,
    mode: &BranchMode,
    display_path: &str,
) -> Result<CommitInfo, String> {
    match mode {
        BranchMode::Follow => {
            let name = wsl_git(distro, linux_path, &["rev-parse", "--abbrev-ref", "HEAD"], display_path)?;
            let branch = match name.trim() {
                "" | "HEAD" => "HEAD（游离）".to_string(),
                other => other.to_string(),
            };
            let text = wsl_git(
                distro,
                linux_path,
                &["log", "-1", "--format=%H%x1e%s%x1e%an%x1e%ct", "HEAD"],
                display_path,
            )?;
            parse_full_commit(&text, branch)
        }
        BranchMode::Pin { name } => {
            let spec = format!("refs/heads/{name}");
            let text = wsl_git(
                distro,
                linux_path,
                &["log", "-1", "--format=%H%x1e%s%x1e%an%x1e%ct", &spec],
                display_path,
            )
            .map_err(|err| {
                if err.contains("unknown revision")
                    || err.contains("bad revision")
                    || err.contains("ambiguous argument")
                    || err.contains("Git 命令失败")
                {
                    format!("仓库中不存在分支「{name}」。可改为「跟随当前分支」，或填写一个已存在的分支。")
                } else {
                    err
                }
            })?;
            parse_full_commit(&text, name.clone())
        }
    }
}

#[cfg(windows)]
fn wsl_git(distro: &str, linux_path: &str, git_args: &[&str], display_path: &str) -> Result<String, String> {
    let args = wsl_git_args(distro, linux_path, git_args);
    let captured = run_program("wsl.exe", &args, None, None)?;
    if captured.status_ok {
        return Ok(captured.stdout);
    }
    Err(map_cli_failure(
        &captured.stderr,
        &captured.stdout,
        &ErrorContext {
            path_hint: display_path,
            wsl_distro: Some(distro),
            wsl_linux_path: Some(linux_path),
            secrets: &[],
        },
    ))
}

#[cfg(windows)]
fn wsl_display_path(distro: &str, linux_path: &str, original_display: &str) -> String {
    let prefix = if original_display.to_ascii_lowercase().contains("wsl.localhost") {
        format!(r"\\wsl.localhost\{distro}")
    } else {
        format!(r"\\wsl$\{distro}")
    };
    format!("{prefix}{}", linux_path.replace('/', "\\"))
}

pub fn wsl_git_args(distro: &str, linux_path: &str, git_args: &[&str]) -> Vec<String> {
    let mut args = vec![
        "-d".to_string(),
        distro.to_string(),
        "-e".to_string(),
        "git".to_string(),
        "-C".to_string(),
        linux_path.to_string(),
    ];
    args.extend(git_args.iter().map(|arg| (*arg).to_string()));
    args
}

fn probe_remote(
    url: &str,
    mode: &BranchMode,
    token: Option<&str>,
    mirror: Option<&Path>,
    previous_hash: Option<&str>,
) -> Result<(CommitInfo, RepoTarget), String> {
    let (branch, hash) = ls_remote(url, mode, token)?;
    let target = RepoTarget::Remote {
        url: url.to_string(),
    };
    if previous_hash == Some(hash.as_str()) {
        return Ok((
            CommitInfo {
                hash,
                branch,
                subject: String::new(),
                author: String::new(),
                timestamp: 0,
                sparse: true,
            },
            target,
        ));
    }
    let details = match mirror {
        Some(dir) if !branch.is_empty() && !branch.contains(' ') => fetch_details(dir, url, &branch, token).ok(),
        _ => None,
    };
    let (subject, author, timestamp) = details.unwrap_or_else(|| (String::new(), String::new(), 0));
    Ok((
        CommitInfo {
            hash,
            branch,
            subject,
            author,
            timestamp,
            sparse: false,
        },
        target,
    ))
}

fn ls_remote(url: &str, mode: &BranchMode, token: Option<&str>) -> Result<(String, String), String> {
    match mode {
        BranchMode::Follow => {
            let stdout = git_stdout(
                &[
                    "ls-remote".into(),
                    "--symref".into(),
                    "--".into(),
                    url.into(),
                    "HEAD".into(),
                ],
                token,
                Some(url),
                url,
            )?;
            parse_ls_remote_head(&stdout)
        }
        BranchMode::Pin { name } => {
            let spec = format!("refs/heads/{name}");
            let stdout = git_stdout(
                &[
                    "ls-remote".into(),
                    "--".into(),
                    url.into(),
                    spec,
                ],
                token,
                Some(url),
                url,
            )?;
            let hash = parse_ls_remote_branch(&stdout, name)?;
            Ok((name.clone(), hash))
        }
    }
}

fn fetch_details(
    mirror: &Path,
    url: &str,
    branch: &str,
    token: Option<&str>,
) -> Result<(String, String, i64), String> {
    if !mirror.join("HEAD").exists() {
        if mirror.exists() {
            std::fs::remove_dir_all(mirror).map_err(|err| format!("无法准备本地镜像目录：{err}"))?;
        }
        if let Some(parent) = mirror.parent() {
            std::fs::create_dir_all(parent).map_err(|err| format!("无法创建镜像目录：{err}"))?;
        }
        let mirror_text = path_to_string(mirror)?;
        git_stdout(
            &[
                "clone".into(),
                "--quiet".into(),
                "--bare".into(),
                "--depth".into(),
                "1".into(),
                "--branch".into(),
                branch.into(),
                "--".into(),
                url.into(),
                mirror_text,
            ],
            token,
            Some(url),
            url,
        )?;
    } else {
        let spec = format!("+refs/heads/{branch}:refs/heads/{branch}");
        git_stdout(&git_dir_args(mirror, &["fetch", "--quiet", "--depth", "1", "origin", &spec])?, token, Some(url), url)?;
    }
    let spec = format!("refs/heads/{branch}");
    let text = git_stdout(
        &git_dir_args(mirror, &["log", "-1", "--format=%s%x1e%an%x1e%ct", &spec])?,
        None,
        None,
        url,
    )?;
    parse_commit_details(&text)
}

fn git_dir_args(dir: &Path, args: &[&str]) -> Result<Vec<String>, String> {
    let mut command = vec!["-C".to_string(), path_to_string(dir)?];
    command.extend(args.iter().map(|arg| (*arg).to_string()));
    Ok(command)
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "路径包含无法表示的字符。".to_string())
}

fn git_stdout(
    args: &[String],
    token: Option<&str>,
    auth_url: Option<&str>,
    path_hint: &str,
) -> Result<String, String> {
    let (captured, secrets) = run_program("git", args, token, auth_url)?;
    if captured.status_ok {
        return Ok(captured.stdout);
    }
    Err(map_cli_failure(
        &captured.stderr,
        &captured.stdout,
        &ErrorContext {
            path_hint,
            wsl_distro: None,
            wsl_linux_path: None,
            secrets: &secrets,
        },
    ))
}

fn run_program(
    program: &str,
    args: &[String],
    token: Option<&str>,
    auth_url: Option<&str>,
) -> Result<(Captured, Vec<String>), String> {
    let mut command = Command::new(program);
    command.args(args);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GCM_INTERACTIVE", "Never");
    command.env("LC_ALL", "C");
    command.env("LANG", "C");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut secrets = Vec::new();
    if let (Some(token), Some(url)) = (token, auth_url) {
        if !token.is_empty() && is_http_url(url) {
            let (user, pass) = credential_user_pass(url, token);
            let header = basic_auth_header(&user, &pass);
            command.env("GIT_CONFIG_COUNT", "1");
            command.env("GIT_CONFIG_KEY_0", "http.extraheader");
            command.env("GIT_CONFIG_VALUE_0", &header);
            command.env_remove("GIT_ASKPASS");
            command.env_remove("SSH_ASKPASS");
            secrets.push(token.to_string());
            if pass != token {
                secrets.push(pass.clone());
            }
            secrets.push(format!("{user}:{pass}"));
            secrets.push(header);
        }
    }

    let captured = spawn_timeout(&mut command, program)?;
    Ok((captured, secrets))
}

fn spawn_timeout(command: &mut Command, program: &str) -> Result<Captured, String> {
    let mut child = command.spawn().map_err(|err| spawn_error(program, &err))?;
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout_thread = thread::spawn(move || read_pipe(stdout_pipe));
    let stderr_thread = thread::spawn(move || read_pipe(stderr_pipe));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > COMMAND_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err("Git 命令超时。请检查网络、凭据，或确认路径可以访问。".into());
            }
            Ok(None) => thread::sleep(Duration::from_millis(30)),
            Err(err) => {
                let _ = child.kill();
                return Err(format!("等待 Git 命令时出错：{err}"));
            }
        }
    };
    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    Ok(Captured {
        status_ok: status.success(),
        stdout,
        stderr,
    })
}

fn spawn_error(program: &str, err: &std::io::Error) -> String {
    if err.kind() == std::io::ErrorKind::NotFound {
        if program.eq_ignore_ascii_case("wsl.exe") || program.eq_ignore_ascii_case("wsl") {
            "未找到 wsl.exe。请在 Windows 上安装 WSL 后再使用 \\\\wsl$\\ 路径。".into()
        } else {
            "未检测到 Git。请先安装 Git，并确保命令 git 在 PATH 中。远程仓库需要它。".into()
        }
    } else {
        format!("无法启动 {program}：{err}")
    }
}

fn read_pipe<R: Read>(pipe: Option<R>) -> String {
    let Some(mut pipe) = pipe else {
        return String::new();
    };
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        if buffer.len() >= 256 * 1024 {
            break;
        }
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(size) => buffer.extend_from_slice(&chunk[..size]),
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buffer).into_owned()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn parse_full_commit(stdout: &str, branch: String) -> Result<CommitInfo, String> {
    let line = stdout.lines().next().unwrap_or("").trim();
    let mut parts = line.split('\u{1e}');
    let hash = parts.next().unwrap_or("").trim().to_string();
    let subject = parts.next().unwrap_or("").trim().to_string();
    let author = parts.next().unwrap_or("").trim().to_string();
    let timestamp = parts.next().unwrap_or("").trim().parse::<i64>().unwrap_or(0);
    if !is_oid(&hash) {
        return Err("无法解析 Git 提交。".into());
    }
    Ok(CommitInfo {
        hash,
        branch,
        subject: truncate_chars(&subject, 500),
        author: if author.is_empty() {
            "unknown".into()
        } else {
            author
        },
        timestamp,
        sparse: false,
    })
}

fn parse_ls_remote_head(stdout: &str) -> Result<(String, String), String> {
    let mut branch = None;
    let mut hash = None;
    for raw in stdout.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("ref:") {
            let rest = rest.trim();
            if let Some(name) = rest.strip_prefix("refs/heads/") {
                let name = name.split_whitespace().next().unwrap_or("");
                if !name.is_empty() {
                    branch = Some(name.to_string());
                }
            }
            continue;
        }
        if let Some(maybe_hash) = line.split_whitespace().next() {
            if is_oid(maybe_hash) {
                hash = Some(maybe_hash.to_string());
            }
        }
    }
    match (branch, hash) {
        (Some(branch), Some(hash)) => Ok((branch, hash)),
        (None, None) => Err("远程仓库没有任何提交，或无法读取默认分支。".into()),
        (None, Some(_)) => Err("无法识别远程默认分支。请改为指定分支。".into()),
        (Some(_), None) => Err("无法读取远程默认分支的提交。".into()),
    }
}

fn parse_ls_remote_branch(stdout: &str, branch: &str) -> Result<String, String> {
    let wanted = format!("refs/heads/{branch}");
    for raw in stdout.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let hash = parts.next().unwrap_or("");
        let reference = parts.next().unwrap_or("");
        if reference == wanted && is_oid(hash) {
            return Ok(hash.to_string());
        }
    }
    if stdout.trim().is_empty() {
        Err(format!(
            "远程仓库中不存在分支「{branch}」。可改为「跟随当前分支」，或填写一个已存在的分支。"
        ))
    } else {
        Err(format!("无法读取远程分支「{branch}」。"))
    }
}

fn parse_commit_details(stdout: &str) -> Result<(String, String, i64), String> {
    let line = stdout.lines().next().unwrap_or("").trim();
    let mut parts = line.split('\u{1e}');
    let subject = parts.next().unwrap_or("").trim().to_string();
    let author = parts.next().unwrap_or("").trim().to_string();
    let timestamp = parts.next().unwrap_or("").trim().parse::<i64>().unwrap_or(0);
    if subject.is_empty() && author.is_empty() {
        return Err("无法解析提交说明。".into());
    }
    Ok((
        truncate_chars(&subject, 500),
        if author.is_empty() {
            "unknown".into()
        } else {
            author
        },
        timestamp,
    ))
}

fn is_oid(value: &str) -> bool {
    (value.len() == 40 || value.len() == 64) && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn truncate_chars(value: &str, max: usize) -> String {
    let count = value.chars().count();
    if count <= max {
        return value.to_string();
    }
    value.chars().take(max).collect::<String>() + "…"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wsl_invocation_is_exec_not_a_shell() {
        let args = wsl_git_args("Ubuntu", "/home/me/my repo", &["rev-parse", "--is-inside-work-tree"]);
        assert_eq!(
            args,
            vec![
                "-d",
                "Ubuntu",
                "-e",
                "git",
                "-C",
                "/home/me/my repo",
                "rev-parse",
                "--is-inside-work-tree"
            ]
        );
        assert!(!args.iter().any(|arg| arg.contains("bash") || arg.contains("sh")));
    }

    #[test]
    fn parses_symbolic_head_and_pinned_branch() {
        let stdout = "ref: refs/heads/main\tHEAD\n\
                      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tHEAD\n";
        let (branch, hash) = parse_ls_remote_head(stdout).unwrap();
        assert_eq!(branch, "main");
        assert_eq!(hash, "a".repeat(40));

        let pinned = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/heads/develop\n";
        assert_eq!(parse_ls_remote_branch(pinned, "develop").unwrap(), "b".repeat(40));
        let missing = parse_ls_remote_branch("", "missing").unwrap_err();
        assert!(missing.contains("不存在分支"));
    }

    #[test]
    fn parses_commit_detail_line() {
        let (subject, author, timestamp) =
            parse_commit_details("init message\u{1e}Ada\u{1e}1700000000\n").unwrap();
        assert_eq!(subject, "init message");
        assert_eq!(author, "Ada");
        assert_eq!(timestamp, 1_700_000_000);
    }

    #[test]
    fn empty_directory_is_not_a_git_repo() {
        let dir = std::env::temp_dir().join(format!("gteam-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let err = probe_local(dir.to_str().unwrap(), &BranchMode::Follow).unwrap_err();
        assert!(err.contains("不是 Git 仓库"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn local_repo_follow_and_pin() {
        let dir = std::env::temp_dir().join(format!("gteam-repo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let repo = Repository::init(&dir).unwrap();
        let unborn = probe_local(dir.to_str().unwrap(), &BranchMode::Follow).unwrap_err();
        assert!(unborn.contains("没有任何提交"), "{unborn}");

        std::fs::write(dir.join("README"), "hello").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("Ada", "ada@example.com").unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "init message", &tree, &[])
            .unwrap();
        drop(tree);
        drop(repo);

        let (info, target) = probe_local(dir.to_str().unwrap(), &BranchMode::Follow).unwrap();
        assert_eq!(info.subject, "init message");
        assert_eq!(info.author, "Ada");
        assert!(!info.branch.is_empty());
        assert_eq!(info.hash.len(), 40);
        let RepoTarget::Local { path } = target else {
            panic!("expected local target");
        };
        assert!(path.ends_with(&dir.file_name().unwrap().to_string_lossy().to_string()) || path == dir.to_string_lossy());

        let (pinned, _) = probe_local(
            dir.to_str().unwrap(),
            &BranchMode::Pin {
                name: info.branch.clone(),
            },
        )
        .unwrap();
        assert_eq!(pinned.hash, info.hash);

        let missing = probe_local(
            dir.to_str().unwrap(),
            &BranchMode::Pin {
                name: "no-such-branch".into(),
            },
        )
        .unwrap_err();
        assert!(missing.contains("不存在分支"));

        let nested = dir.join("src");
        std::fs::create_dir_all(&nested).unwrap();
        let (nested_info, nested_target) = probe_local(nested.to_str().unwrap(), &BranchMode::Follow).unwrap();
        assert_eq!(nested_info.hash, info.hash);
        let RepoTarget::Local { path } = nested_target else {
            panic!("expected discovered root");
        };
        assert!(!path.ends_with("src"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
