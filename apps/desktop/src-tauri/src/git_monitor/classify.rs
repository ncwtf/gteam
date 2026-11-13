//! 纯函数：识别本地路径、WSL UNC、远程 URL，并把 Git 错误翻成中文。
//! 这里不执行 Git，也不保存令牌。

use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocationKind {
    Local { path: String },
    Wsl {
        distro: String,
        linux_path: String,
        display_path: String,
    },
    Remote { url: String },
}

pub struct ClassifiedLocation {
    pub kind: LocationKind,
    pub embedded_token: Option<String>,
}

impl std::fmt::Debug for ClassifiedLocation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ClassifiedLocation")
            .field("kind", &self.kind)
            .field(
                "embedded_token",
                &self.embedded_token.as_ref().map(|_| "***"),
            )
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WslLocation {
    pub distro: String,
    pub linux_path: String,
    pub display_path: String,
}

pub struct ErrorContext<'a> {
    pub path_hint: &'a str,
    pub wsl_distro: Option<&'a str>,
    pub wsl_linux_path: Option<&'a str>,
    pub secrets: &'a [String],
}

pub fn resolve_location(input: &str) -> Result<ClassifiedLocation, String> {
    let raw = input.trim().trim_matches('"').trim();
    if raw.is_empty() {
        return Err("请填写仓库路径或远程地址。".into());
    }
    if raw.chars().count() > 4096 {
        return Err("路径或地址过长。".into());
    }
    if raw.chars().any(|c| c.is_control()) {
        return Err("路径或地址包含无效字符。".into());
    }

    if let Some(remote) = parse_remote(raw)? {
        return Ok(remote);
    }

    if looks_like_wsl(raw) {
        let Some(wsl) = parse_wsl_unc(raw) else {
            return Err(wsl_incomplete_message());
        };
        if !cfg!(windows) {
            let _ = wsl;
            return Err("WSL 路径仅支持在 Windows 上使用。".into());
        }
        return Ok(ClassifiedLocation {
            kind: LocationKind::Wsl {
                distro: wsl.distro,
                linux_path: wsl.linux_path,
                display_path: wsl.display_path,
            },
            embedded_token: None,
        });
    }

    if looks_like_remote_without_scheme(raw) {
        return Err(
            "远程仓库请使用完整地址，例如 https://github.com/ncwtf/gteam 或 git@github.com:ncwtf/gteam.git。"
                .into(),
        );
    }

    resolve_local(raw)
}

pub fn parse_wsl_unc(input: &str) -> Option<WslLocation> {
    let trimmed = input.trim().trim_matches('"').trim();
    if !looks_like_wsl(trimmed) {
        return None;
    }
    let mut normalized = trimmed.replace('/', "\\");
    if let Some(rest) = strip_prefix_ignore_ascii_case(&normalized, "\\\\?\\UNC\\") {
        normalized = format!("\\\\{rest}");
    } else if let Some(rest) = strip_prefix_ignore_ascii_case(&normalized, "\\\\?\\") {
        normalized = rest.to_string();
    }

    let lower = normalized.to_ascii_lowercase();
    let prefix = if lower.starts_with("\\\\wsl$\\") {
        "\\\\wsl$\\"
    } else if lower.starts_with("\\\\wsl.localhost\\") {
        "\\\\wsl.localhost\\"
    } else {
        return None;
    };
    let rest = normalized.get(prefix.len()..)?;
    let (distro, tail) = rest.split_once('\\')?;
    if !valid_distro(distro) || tail.is_empty() {
        return None;
    }
    let linux_body = tail.trim_matches('\\').replace('\\', "/");
    if linux_body.is_empty() {
        return None;
    }
    let linux_path = collapse_slashes(&format!("/{linux_body}"));
    if linux_path == "/" {
        return None;
    }
    let display_prefix = if lower.starts_with("\\\\wsl.localhost\\") {
        format!("\\\\wsl.localhost\\{distro}")
    } else {
        format!("\\\\wsl$\\{distro}")
    };
    let display_path = format!("{display_prefix}{}", linux_path.replace('/', "\\"));
    Some(WslLocation {
        distro: distro.to_string(),
        linux_path,
        display_path,
    })
}

pub fn parse_branch_mode(follow: bool, branch: Option<String>) -> Result<crate::git_monitor::store::BranchMode, String> {
    use crate::git_monitor::store::BranchMode;
    if follow {
        return Ok(BranchMode::Follow);
    }
    let name = branch.unwrap_or_default();
    let name = name.trim();
    if name.is_empty() {
        return Err("请填写要固定的分支名称，或选择「跟随当前分支」。".into());
    }
    validate_branch_name(name)?;
    Ok(BranchMode::Pin {
        name: name.to_string(),
    })
}

pub fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 255 {
        return Err("分支名称无效。请填写已有分支，例如 main 或 feature/login。".into());
    }
    let invalid = name.starts_with('-')
        || name.starts_with('/')
        || name.ends_with('/')
        || name.ends_with('.')
        || name.ends_with(".lock")
        || name.contains("..")
        || name.contains('@')
        || name.contains('\\')
        || name.contains(':')
        || name.contains('~')
        || name.contains('^')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
        || name.contains(' ')
        || name.contains('\t')
        || name.contains("//")
        || name.chars().any(|c| c.is_control());
    if invalid {
        return Err("分支名称无效。请填写已有分支，例如 main 或 feature/login。".into());
    }
    Ok(())
}

pub fn normalize_requirement_id(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if !is_uuid(value) {
        return Err("需求 ID 格式不正确。请从列表中选择需求，或粘贴完整 UUID；留空表示不关联。".into());
    }
    Ok(Some(value.to_ascii_lowercase()))
}

pub fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (index, byte) in bytes.iter().enumerate() {
        match index {
            8 | 13 | 18 | 23 => {
                if *byte != b'-' {
                    return false;
                }
            }
            _ => {
                if !byte.is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    true
}

pub fn credential_user_pass(url: &str, token: &str) -> (String, String) {
    let token = token.trim();
    if let Some((user, pass)) = token.split_once(':') {
        let user = user.trim();
        let pass = pass.trim();
        let reserved = user.eq_ignore_ascii_case("x-access-token")
            || user.eq_ignore_ascii_case("oauth2")
            || user.eq_ignore_ascii_case("git")
            || user.eq_ignore_ascii_case("gitlab-ci-token")
            || user.starts_with("ghp_")
            || user.starts_with("github_pat_")
            || user.starts_with("gho_")
            || user.starts_with("glpat-");
        if !user.is_empty() && !pass.is_empty() && !reserved {
            return (user.to_string(), pass.to_string());
        }
    }
    let host = remote_host(url);
    if host.contains("gitlab") {
        ("oauth2".to_string(), token.to_string())
    } else {
        ("x-access-token".to_string(), token.to_string())
    }
}

pub fn basic_auth_header(user: &str, pass: &str) -> String {
    let raw = format!("{user}:{pass}");
    format!("Authorization: Basic {}", base64_encode(raw.as_bytes()))
}

pub fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut index = 0;
    while index + 3 <= data.len() {
        let chunk = ((data[index] as u32) << 16)
            | ((data[index + 1] as u32) << 8)
            | (data[index + 2] as u32);
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 6) & 63) as usize] as char);
        out.push(TABLE[(chunk & 63) as usize] as char);
        index += 3;
    }
    let remaining = data.len() - index;
    if remaining == 1 {
        let chunk = (data[index] as u32) << 16;
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if remaining == 2 {
        let chunk = ((data[index] as u32) << 16) | ((data[index + 1] as u32) << 8);
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

pub fn redact(text: &str, secrets: &[String]) -> String {
    let mut items: Vec<&str> = secrets.iter().map(String::as_str).filter(|s| s.len() >= 6).collect();
    items.sort_by_key(|s| std::cmp::Reverse(s.len()));
    items.dedup();
    let mut out = text.to_string();
    for secret in items {
        if out.contains(secret) {
            out = out.replace(secret, "***");
        }
    }
    out.lines()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            !lower.contains("authorization:")
                && !lower.contains("extraheader")
                && !lower.contains("private-token")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn map_cli_failure(stderr: &str, stdout: &str, context: &ErrorContext<'_>) -> String {
    let combined = redact(&format!("{stderr}\n{stdout}"), context.secrets);
    let lower = combined.to_ascii_lowercase();
    if is_dubious_ownership(&lower) {
        return dubious_ownership_message(context.path_hint, context.wsl_distro, context.wsl_linux_path);
    }
    if lower.contains("permission denied (publickey)")
        || (lower.contains("could not read from remote repository") && lower.contains("publickey"))
        || lower.contains("permission denied (publickey)")
    {
        return "无法通过 SSH 访问远程仓库。请确认 SSH 密钥已添加到 Git 托管方，并且本机 ssh 能访问该地址。访问令牌只用于 HTTPS。".into();
    }
    if lower.contains("authentication failed")
        || lower.contains("terminal prompts disabled")
        || lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("invalid username or password")
        || lower.contains("http basic: access denied")
        || lower.contains("authentication required")
        || lower.contains("401")
        || combined.contains("认证失败")
    {
        return "远程仓库认证失败。请确认本机 Git 凭据或 SSH 密钥可用，或填写有权限的访问令牌。令牌只保存在本机，不会发送到团队服务器。".into();
    }
    if lower.contains("repository not found")
        || lower.contains("not found") && lower.contains("repository")
        || combined.contains("仓库不存在")
    {
        return "找不到远程仓库。请检查地址；私有仓库在未认证时也会显示为不存在。".into();
    }
    if lower.contains("not a git repository") || combined.contains("不是 git 仓库") || combined.contains("不是一个 git 仓库") {
        return format!("该路径不是 Git 仓库（未找到 .git）：{}", context.path_hint);
    }
    if lower.contains("command not found")
        || lower.contains("不是内部或外部命令")
        || lower.contains("no such file or directory") && lower.contains("git")
    {
        return "未找到 git 命令。请先安装 Git，并确保它在 PATH 中。".into();
    }
    if context.wsl_distro.is_some()
        && (lower.contains("wsl_e_distro_not_found")
            || lower.contains("there is no distribution")
            || lower.contains("没有已安装的分发")
            || lower.contains("cannot find distribution"))
    {
        return format!(
            "找不到 WSL 发行版「{}」。请确认名称与 wsl -l 中的一致，且该发行版可以启动。",
            context.wsl_distro.unwrap_or("")
        );
    }
    if context.wsl_distro.is_some()
        && (lower.contains("git: not found")
            || lower.contains("git: command not found")
            || lower.contains("executable file not found"))
    {
        return format!(
            "WSL 发行版「{}」中未安装 git。请在该发行版内安装 Git 后重试。",
            context.wsl_distro.unwrap_or("")
        );
    }
    let brief = first_line(&combined);
    if brief.is_empty() {
        "Git 命令失败。请检查路径、分支和凭据。".into()
    } else {
        format!("Git 命令失败：{brief}")
    }
}

pub fn map_git2_message(message: &str, path: &str) -> String {
    if is_dubious_ownership(message) {
        return dubious_ownership_message(path, None, None);
    }
    let lower = message.to_ascii_lowercase();
    if lower.contains("not a git repository")
        || lower.contains("could not find repository")
        || lower.contains("does not appear to be a git")
    {
        return format!("该文件夹不是 Git 仓库（未找到 .git）：{path}");
    }
    let brief = first_line(message);
    if brief.is_empty() {
        format!("无法读取 Git 仓库：{path}")
    } else {
        format!("无法读取 Git 仓库：{brief}")
    }
}

pub fn is_dubious_ownership(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("dubious ownership")
        || lower.contains("safe.directory")
        || lower.contains("not owned by current user")
        || lower.contains("可疑所有权")
        || lower.contains("存疑的所有权")
}

pub fn dubious_ownership_message(
    path_hint: &str,
    wsl_distro: Option<&str>,
    wsl_linux_path: Option<&str>,
) -> String {
    if let (Some(distro), Some(linux)) = (wsl_distro, wsl_linux_path) {
        format!(
            "仓库所有权不受信任（Git dubious ownership）。请在 WSL 发行版 {distro} 中执行：git config --global --add safe.directory '{linux}'"
        )
    } else {
        format!(
            "仓库所有权不受信任（Git dubious ownership）。请在该环境执行：git config --global --add safe.directory '{path_hint}'"
        )
    }
}

pub fn is_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

fn parse_remote(raw: &str) -> Result<Option<ClassifiedLocation>, String> {
    let lower = raw.to_ascii_lowercase();
    let http = lower.starts_with("https://") || lower.starts_with("http://");
    let other = lower.starts_with("ssh://") || lower.starts_with("git://") || is_scp_git(raw);
    if !http && !other {
        return Ok(None);
    }
    if http {
        let (url, token) = strip_http_userinfo(raw)?;
        validate_http_url(&url)?;
        return Ok(Some(ClassifiedLocation {
            kind: LocationKind::Remote { url },
            embedded_token: token,
        }));
    }
    validate_plain_git_url(raw)?;
    Ok(Some(ClassifiedLocation {
        kind: LocationKind::Remote {
            url: raw.to_string(),
        },
        embedded_token: None,
    }))
}

fn is_scp_git(raw: &str) -> bool {
    let Some(rest) = raw.strip_prefix("git@") else {
        return false;
    };
    match rest.split_once(':') {
        Some((host, path)) => {
            !host.is_empty() && !host.contains('/') && !path.is_empty() && !path.starts_with("//")
        }
        None => false,
    }
}

fn validate_http_url(url: &str) -> Result<(), String> {
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or("");
    if rest.is_empty() || rest.starts_with('/') {
        return Err("远程地址不完整。请包含主机名和仓库路径，例如 https://github.com/ncwtf/gteam。".into());
    }
    let (host, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, ""),
    };
    let host_name = host.split(':').next().unwrap_or(host);
    if host_name.is_empty() {
        return Err("远程地址缺少主机名。".into());
    }
    if path.trim_matches('/').is_empty() {
        return Err("远程地址不完整，请包含仓库路径，例如 https://github.com/ncwtf/gteam。".into());
    }
    Ok(())
}

fn validate_plain_git_url(url: &str) -> Result<(), String> {
    if is_scp_git(url) {
        return Ok(());
    }
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or("");
    let rest = rest.split('@').next_back().unwrap_or(rest);
    if !rest.contains('/') || rest.ends_with('/') || rest.starts_with('/') {
        return Err("远程地址不完整，请包含主机名和仓库路径。".into());
    }
    Ok(())
}

fn strip_http_userinfo(url: &str) -> Result<(String, Option<String>), String> {
    let Some((scheme, rest)) = url.split_once("://") else {
        return Ok((url.to_string(), None));
    };
    let slash = rest.find('/').unwrap_or(rest.len());
    let authority = &rest[..slash];
    let path = &rest[slash..];
    let Some((userinfo, host)) = authority.rsplit_once('@') else {
        return Ok((url.to_string(), None));
    };
    if host.is_empty() {
        return Err("远程地址缺少主机名。".into());
    }
    let token = embedded_secret(userinfo);
    Ok((format!("{scheme}://{host}{path}"), token))
}

fn embedded_secret(userinfo: &str) -> Option<String> {
    let (user, pass) = match userinfo.split_once(':') {
        Some((user, pass)) => (percent_decode(user), percent_decode(pass)),
        None => (percent_decode(userinfo), String::new()),
    };
    if pass.is_empty() {
        return if user.is_empty() { None } else { Some(user) };
    }
    let generic = user.is_empty()
        || user.eq_ignore_ascii_case("x-access-token")
        || user.eq_ignore_ascii_case("oauth2")
        || user.eq_ignore_ascii_case("git")
        || user.eq_ignore_ascii_case("gitlab-ci-token");
    if generic {
        Some(pass)
    } else {
        Some(format!("{user}:{pass}"))
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
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

fn remote_host(url: &str) -> String {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let authority = without_scheme.split('/').next().unwrap_or(without_scheme);
    let host = if url.starts_with("git@") {
        url.trim_start_matches("git@").split(':').next().unwrap_or("")
    } else {
        authority.rsplit_once('@').map(|(_, host)| host).unwrap_or(authority)
    };
    host.split(':').next().unwrap_or(host).to_ascii_lowercase()
}

fn resolve_local(raw: &str) -> Result<ClassifiedLocation, String> {
    let expanded = expand_tilde(raw);
    let path = PathBuf::from(&expanded);
    if !path.is_absolute() {
        return Err("请填写仓库的绝对路径，或使用「选择文件夹」。远程仓库请使用 https:// 或 git@ 开头的地址。".into());
    }
    if !path.exists() {
        return Err(format!(
            "路径不存在：{}。请选择本机上的 Git 仓库文件夹，或填写远程仓库地址（例如 https://github.com/ncwtf/gteam）。",
            path.display()
        ));
    }
    if !path.is_dir() {
        return Err(format!("路径不是文件夹：{}", path.display()));
    }
    let stored = match path.canonicalize() {
        Ok(canonical) => strip_verbatim_prefix(&canonical),
        Err(_) => path,
    };
    let mut display = stored.to_string_lossy().to_string();
    while display.len() > 1 && (display.ends_with('/') || display.ends_with('\\')) {
        display.pop();
    }
    if display.is_empty() {
        return Err("路径无效。".into());
    }
    Ok(ClassifiedLocation {
        kind: LocationKind::Local { path: display },
        embedded_token: None,
    })
}

fn expand_tilde(raw: &str) -> String {
    let Some(home) = home_dir() else {
        return raw.to_string();
    };
    if raw == "~" {
        return home.to_string_lossy().into_owned();
    }
    if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        return home.join(rest).to_string_lossy().into_owned();
    }
    raw.to_string()
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

fn looks_like_wsl(input: &str) -> bool {
    let normalized = input.trim().replace('/', "\\");
    let mut extended = normalized;
    if let Some(rest) = strip_prefix_ignore_ascii_case(&extended, "\\\\?\\UNC\\") {
        extended = format!("\\\\{rest}");
    } else if let Some(rest) = strip_prefix_ignore_ascii_case(&extended, "\\\\?\\") {
        extended = rest.to_string();
    }
    let lower = extended.to_ascii_lowercase();
    lower.starts_with("\\\\wsl$\\") || lower.starts_with("\\\\wsl.localhost\\") || lower == "\\\\wsl$" || lower == "\\\\wsl.localhost"
}

fn looks_like_remote_without_scheme(input: &str) -> bool {
    if input.contains('\\') || input.starts_with('/') || input.starts_with('.') {
        return false;
    }
    let lower = input.to_ascii_lowercase();
    lower.starts_with("github.com/")
        || lower.starts_with("www.github.com/")
        || lower.starts_with("gitlab.com/")
        || lower.starts_with("bitbucket.org/")
}

fn wsl_incomplete_message() -> String {
    format!(
        "WSL 路径不完整。请使用 {}<发行版>\\... 或 {}<发行版>\\...，并包含发行版中的目录。",
        r"\\wsl$\", r"\\wsl.localhost\"
    )
}

fn valid_distro(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(' ')
        && !name.ends_with(' ')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
}

fn collapse_slashes(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let mut previous_slash = false;
    for ch in path.chars() {
        if ch == '/' {
            if previous_slash {
                continue;
            }
            previous_slash = true;
        } else {
            previous_slash = false;
        }
        out.push(ch);
    }
    if out.len() > 1 && out.ends_with('/') {
        out.pop();
    }
    out
}

fn strip_prefix_ignore_ascii_case<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() >= prefix.len() && value[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}

fn first_line(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let mut shortened = String::new();
    for (index, ch) in line.chars().enumerate() {
        if index >= 300 {
            shortened.push('…');
            break;
        }
        shortened.push(ch);
    }
    shortened
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_https_url_is_remote_not_a_filesystem_path() {
        let resolved = resolve_location("https://github.com/ncwtf/gteam").unwrap();
        match resolved.kind {
            LocationKind::Remote { url } => assert_eq!(url, "https://github.com/ncwtf/gteam"),
            _ => panic!("expected remote url"),
        }
        assert!(resolved.embedded_token.is_none());
    }

    #[test]
    fn strips_credentials_from_https_url() {
        let resolved =
            resolve_location("https://myuser:p%40ss@github.com/ncwtf/gteam.git").unwrap();
        match resolved.kind {
            LocationKind::Remote { url } => {
                assert_eq!(url, "https://github.com/ncwtf/gteam.git");
            }
            _ => panic!("expected remote"),
        }
        assert_eq!(resolved.embedded_token.as_deref(), Some("myuser:p@ss"));
    }

    #[test]
    fn scp_and_ssh_urls_are_remote() {
        let scp = resolve_location("git@github.com:ncwtf/gteam.git").unwrap();
        assert!(matches!(scp.kind, LocationKind::Remote { .. }));
        let ssh = resolve_location("ssh://git@github.com/ncwtf/gteam.git").unwrap();
        assert!(matches!(ssh.kind, LocationKind::Remote { .. }));
    }

    #[test]
    fn incomplete_remote_is_rejected() {
        let err = resolve_location("https://github.com").unwrap_err();
        assert!(err.contains("仓库路径"));
        let err = resolve_location("github.com/ncwtf/gteam").unwrap_err();
        assert!(err.contains("完整地址"));
    }

    #[test]
    fn parses_wsl_dollar_and_localhost() {
        let wsl = parse_wsl_unc(r"\\wsl$\Ubuntu\home\me\proj").unwrap();
        assert_eq!(wsl.distro, "Ubuntu");
        assert_eq!(wsl.linux_path, "/home/me/proj");
        assert_eq!(wsl.display_path, r"\\wsl$\Ubuntu\home\me\proj");

        let local = parse_wsl_unc("//wsl.localhost/Debian/mnt/c/src").unwrap();
        assert_eq!(local.distro, "Debian");
        assert_eq!(local.linux_path, "/mnt/c/src");
        assert!(local.display_path.starts_with(r"\\wsl.localhost\Debian"));
    }

    #[test]
    fn parses_extended_unc_wsl_path() {
        let wsl = parse_wsl_unc(r"\\?\UNC\wsl$\Ubuntu\home\me\proj").unwrap();
        assert_eq!(wsl.distro, "Ubuntu");
        assert_eq!(wsl.linux_path, "/home/me/proj");
    }

    #[test]
    fn does_not_treat_normal_paths_or_urls_as_wsl() {
        assert!(parse_wsl_unc(r"C:\src\gteam").is_none());
        assert!(parse_wsl_unc(r"\\server\share\repo").is_none());
        assert!(parse_wsl_unc("https://github.com/ncwtf/gteam").is_none());
        assert!(parse_wsl_unc("/home/me/proj").is_none());
    }

    #[test]
    fn wsl_path_on_this_platform_is_classified() {
        let result = resolve_location(r"\\wsl$\Ubuntu\home\me\proj");
        if cfg!(windows) {
            let resolved = result.unwrap();
            assert!(matches!(resolved.kind, LocationKind::Wsl { .. }));
        } else {
            let err = result.unwrap_err();
            assert!(err.contains("Windows"));
        }
    }

    #[test]
    fn follow_branch_is_default_and_pin_requires_a_name() {
        assert!(matches!(
            parse_branch_mode(true, None).unwrap(),
            crate::git_monitor::store::BranchMode::Follow
        ));
        let err = parse_branch_mode(false, Some("  ".into())).unwrap_err();
        assert!(err.contains("跟随当前分支"));
        match parse_branch_mode(false, Some("feature/login".into())).unwrap() {
            crate::git_monitor::store::BranchMode::Pin { name } => assert_eq!(name, "feature/login"),
            _ => panic!("expected pin"),
        }
    }

    #[test]
    fn requirement_id_is_optional_uuid() {
        assert_eq!(normalize_requirement_id(None).unwrap(), None);
        assert_eq!(normalize_requirement_id(Some("  ".into())).unwrap(), None);
        let id = "550E8400-E29B-41D4-A716-446655440000";
        assert_eq!(
            normalize_requirement_id(Some(id.into())).unwrap().as_deref(),
            Some("550e8400-e29b-41d4-a716-446655440000")
        );
        assert!(normalize_requirement_id(Some("not-a-uuid".into())).is_err());
    }

    #[test]
    fn credential_identity_depends_on_host() {
        let (user, pass) = credential_user_pass("https://github.com/ncwtf/gteam.git", "ghp_example");
        assert_eq!(user, "x-access-token");
        assert_eq!(pass, "ghp_example");
        let (user, pass) = credential_user_pass("https://gitlab.com/group/proj.git", "glpat-abc123");
        assert_eq!(user, "oauth2");
        assert_eq!(pass, "glpat-abc123");
        let (user, pass) =
            credential_user_pass("https://bitbucket.org/team/repo.git", "myuser:app-password");
        assert_eq!(user, "myuser");
        assert_eq!(pass, "app-password");
    }

    #[test]
    fn base64_and_redaction_hide_tokens() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b"h"), "aA==");
        assert_eq!(base64_encode(b"hi"), "aGk=");
        let token = "ghp_supersecretvalue".to_string();
        let header = basic_auth_header("x-access-token", &token);
        let stderr = format!("fatal: Authentication failed\n{header}\nsee {token}");
        let redacted = redact(&stderr, &[token.clone(), header.clone()]);
        assert!(!redacted.contains(&token));
        assert!(!redacted.to_ascii_lowercase().contains("authorization:"));
    }

    #[test]
    fn dubious_ownership_message_is_chinese_and_actionable() {
        let stderr = "fatal: detected dubious ownership in repository at '/home/me/proj'\n\
                      To add an exception for this directory, call:\n\n\
                      \tgit config --global --add safe.directory /home/me/proj\n";
        let message = map_cli_failure(
            stderr,
            "",
            &ErrorContext {
                path_hint: "/home/me/proj",
                wsl_distro: None,
                wsl_linux_path: None,
                secrets: &[],
            },
        );
        assert!(message.contains("dubious ownership"));
        assert!(message.contains("safe.directory"));
        assert!(message.contains("/home/me/proj"));

        let wsl = map_cli_failure(
            stderr,
            "",
            &ErrorContext {
                path_hint: r"\\wsl$\Ubuntu\home\me\proj",
                wsl_distro: Some("Ubuntu"),
                wsl_linux_path: Some("/home/me/proj"),
                secrets: &[],
            },
        );
        assert!(wsl.contains("WSL 发行版 Ubuntu"));
        assert!(wsl.contains("/home/me/proj"));
    }

    #[test]
    fn git2_owner_message_is_mapped() {
        let message = map_git2_message(
            "repository path '/srv/repo' is not owned by current user",
            "/srv/repo",
        );
        assert!(message.contains("safe.directory"));
        assert!(message.contains("/srv/repo"));
    }

    #[test]
    fn local_directory_that_exists_is_local() {
        let dir = std::env::temp_dir().join(format!(
            "gteam-classify-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let resolved = resolve_location(dir.to_str().unwrap()).unwrap();
        match resolved.kind {
            LocationKind::Local { path } => {
                assert!(!path.is_empty());
                assert!(!path.contains("github.com"));
            }
            _ => panic!("expected local path"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_path_mentions_remote_alternative() {
        let missing = if cfg!(windows) {
            r"C:\gteam-does-not-exist-12345"
        } else {
            "/tmp/gteam-does-not-exist-12345"
        };
        let err = resolve_location(missing).unwrap_err();
        assert!(err.contains("路径不存在"));
        assert!(err.contains("https://github.com"));
    }
}
