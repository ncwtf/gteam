//! 监控列表的磁盘格式。令牌不在这个结构里。

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;

pub const STORE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RepoTarget {
    Local { path: String },
    Wsl {
        distro: String,
        linux_path: String,
        display_path: String,
    },
    Remote { url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum BranchMode {
    Follow,
    Pin { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MonitorRecord {
    pub id: String,
    pub connection_id: String,
    pub target: RepoTarget,
    pub branch_mode: BranchMode,
    pub requirement_id: Option<String>,
    pub has_token: bool,
    pub last_commit: Option<String>,
    pub last_branch: Option<String>,
    pub last_subject: Option<String>,
    pub last_author: Option<String>,
    pub last_timestamp: Option<i64>,
    pub last_error: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct DiskFile {
    version: u32,
    monitors: Vec<MonitorRecord>,
}

impl RepoTarget {
    pub fn display_path(&self) -> &str {
        match self {
            RepoTarget::Local { path } => path,
            RepoTarget::Wsl { display_path, .. } => display_path,
            RepoTarget::Remote { url } => url,
        }
    }

    pub fn kind_name(&self) -> &'static str {
        match self {
            RepoTarget::Local { .. } => "local",
            RepoTarget::Wsl { .. } => "wsl",
            RepoTarget::Remote { .. } => "remote",
        }
    }

    /// WSL 的文件系统通知不可靠，远程仓库没有本地目录，两者都只轮询。
    pub fn uses_filesystem_notify(&self) -> bool {
        matches!(self, RepoTarget::Local { .. })
    }

    pub fn poll_interval(&self) -> Duration {
        match self {
            RepoTarget::Remote { .. } => Duration::from_secs(20),
            RepoTarget::Local { .. } | RepoTarget::Wsl { .. } => Duration::from_secs(5),
        }
    }

    pub fn dedup_key(&self) -> String {
        match self {
            RepoTarget::Local { path } => format!("local:{}", normalize_local_key(path)),
            RepoTarget::Wsl {
                distro, linux_path, ..
            } => format!(
                "wsl:{}:{}",
                distro.to_ascii_lowercase(),
                normalize_linux_key(linux_path)
            ),
            RepoTarget::Remote { url } => format!("remote:{}", normalize_remote_key(url)),
        }
    }
}

pub fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !id.contains("..")
}

pub fn load_records(path: &Path) -> Result<Vec<MonitorRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(path).map_err(|err| format!("无法读取监控列表：{err}"))?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    match serde_json::from_str::<DiskFile>(&text) {
        Ok(file) => Ok(file
            .monitors
            .into_iter()
            .filter(|record| safe_id(&record.id) && !record.connection_id.is_empty())
            .collect()),
        Err(err) => {
            let backup = path.with_extension("json.bak");
            let _ = std::fs::rename(path, &backup);
            Err(format!(
                "监控列表格式无法识别，已保留备份 {}：{err}",
                backup.display()
            ))
        }
    }
}

pub fn save_records(path: &Path, records: &[MonitorRecord]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("无法创建目录：{err}"))?;
    }
    let file = DiskFile {
        version: STORE_VERSION,
        monitors: records.to_vec(),
    };
    let data = serde_json::to_vec_pretty(&file).map_err(|err| format!("无法序列化监控列表：{err}"))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, data).map_err(|err| format!("无法写入监控列表：{err}"))?;
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    std::fs::rename(&temporary, path).map_err(|err| format!("无法保存监控列表：{err}"))
}

fn normalize_local_key(path: &str) -> String {
    #[cfg(windows)]
    {
        let mut text = path.replace('/', "\\");
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            text = format!(r"\\{rest}");
        } else if let Some(rest) = text.strip_prefix(r"\\?\") {
            text = rest.to_string();
        }
        while text.len() > 3 && text.ends_with('\\') {
            text.pop();
        }
        text.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        let mut text = path.to_string();
        while text.len() > 1 && text.ends_with('/') {
            text.pop();
        }
        text
    }
}

fn normalize_linux_key(path: &str) -> String {
    let mut text = path.replace('\\', "/");
    while text.contains("//") {
        text = text.replace("//", "/");
    }
    while text.len() > 1 && text.ends_with('/') {
        text.pop();
    }
    text
}

fn normalize_remote_key(url: &str) -> String {
    let mut text = url.trim().trim_end_matches('/').to_string();
    if let Some(stripped) = text.strip_suffix(".git") {
        text = stripped.to_string();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(target: RepoTarget) -> MonitorRecord {
        MonitorRecord {
            id: "123-1".into(),
            connection_id: "team-1".into(),
            target,
            branch_mode: BranchMode::Follow,
            requirement_id: None,
            has_token: true,
            last_commit: Some("abc".into()),
            last_branch: Some("main".into()),
            last_subject: Some("init".into()),
            last_author: Some("Ada".into()),
            last_timestamp: Some(1),
            last_error: None,
            created_at_ms: 1,
            updated_at_ms: 1,
        }
    }

    #[test]
    fn wsl_and_remote_do_not_use_filesystem_notifications() {
        let local = RepoTarget::Local {
            path: "/tmp/repo".into(),
        };
        let wsl = RepoTarget::Wsl {
            distro: "Ubuntu".into(),
            linux_path: "/home/me/repo".into(),
            display_path: r"\\wsl$\Ubuntu\home\me\repo".into(),
        };
        let remote = RepoTarget::Remote {
            url: "https://github.com/ncwtf/gteam".into(),
        };
        assert!(local.uses_filesystem_notify());
        assert!(!wsl.uses_filesystem_notify());
        assert!(!remote.uses_filesystem_notify());
        assert!(remote.poll_interval() > local.poll_interval());
        assert_eq!(wsl.poll_interval(), local.poll_interval());
    }

    #[test]
    fn remote_git_suffix_dedups_and_roundtrip_has_no_secret() {
        let a = RepoTarget::Remote {
            url: "https://github.com/ncwtf/gteam".into(),
        };
        let b = RepoTarget::Remote {
            url: "https://github.com/ncwtf/gteam.git".into(),
        };
        assert_eq!(a.dedup_key(), b.dedup_key());

        let secret = "ghp_this_must_not_be_persisted";
        let dir = std::env::temp_dir().join(format!("gteam-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("git-monitors.json");
        let record = sample(a);
        save_records(&path, &[record.clone()]).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains(secret));
        assert!(text.contains("\"has_token\": true"));
        let loaded = load_records(&path).unwrap();
        assert_eq!(loaded, vec![record]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsafe_ids_are_dropped_on_load() {
        assert!(!safe_id("../etc"));
        assert!(!safe_id(""));
        assert!(safe_id("170000-1"));
    }
}
