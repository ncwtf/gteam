//! 远程仓库访问令牌只存在客户端。
//! 优先写入系统钥匙串；钥匙串不可用时落到应用数据目录里的本地文件。
//! 不要把令牌写进监控列表、日志，或发往 gteam 服务器。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use super::store::safe_id;

const SERVICE_NAME: &str = "com.gteam.desktop";
static TOKEN_FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default, Serialize, Deserialize)]
struct TokenDisk {
    tokens: BTreeMap<String, String>,
}

pub fn save_token(file: &Path, id: &str, token: &str) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("访问令牌为空。".into());
    }
    if !safe_id(id) {
        return Err("内部错误：监控项 ID 无效。".into());
    }
    match keyring_set(id, token) {
        Ok(()) => {
            let _ = file_remove(file, id);
            Ok(())
        }
        Err(_) => file_set(file, id, token),
    }
}

pub fn load_token(file: &Path, id: &str) -> Option<String> {
    if !safe_id(id) {
        return None;
    }
    match keyring_get(id) {
        Ok(token) if !token.is_empty() => return Some(token),
        _ => {}
    }
    file_get(file, id)
}

pub fn delete_token(file: &Path, id: &str) {
    if !safe_id(id) {
        return;
    }
    let _ = keyring_delete(id);
    let _ = file_remove(file, id);
}

fn account(id: &str) -> String {
    format!("git-access-token:{id}")
}

fn keyring_set(id: &str, token: &str) -> Result<(), keyring::Error> {
    let entry = keyring::Entry::new(SERVICE_NAME, &account(id))?;
    entry.set_password(token)
}

fn keyring_get(id: &str) -> Result<String, keyring::Error> {
    let entry = keyring::Entry::new(SERVICE_NAME, &account(id))?;
    entry.get_password()
}

fn keyring_delete(id: &str) -> Result<(), keyring::Error> {
    let entry = keyring::Entry::new(SERVICE_NAME, &account(id))?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err),
    }
}

fn file_set(path: &Path, id: &str, token: &str) -> Result<(), String> {
    let _guard = TOKEN_FILE_LOCK.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("无法创建令牌目录：{err}"))?;
    }
    let mut disk = read_disk(path)?;
    disk.tokens.insert(id.to_string(), token.to_string());
    write_disk(path, &disk)
}

fn file_get(path: &Path, id: &str) -> Option<String> {
    let _guard = TOKEN_FILE_LOCK.lock().unwrap_or_else(|err| err.into_inner());
    let disk = read_disk(path).ok()?;
    disk.tokens.get(id).cloned()
}

fn file_remove(path: &Path, id: &str) -> Result<(), String> {
    let _guard = TOKEN_FILE_LOCK.lock().unwrap_or_else(|err| err.into_inner());
    if !path.exists() {
        return Ok(());
    }
    let mut disk = read_disk(path)?;
    disk.tokens.remove(id);
    write_disk(path, &disk)
}

fn read_disk(path: &Path) -> Result<TokenDisk, String> {
    if !path.exists() {
        return Ok(TokenDisk::default());
    }
    let text = std::fs::read_to_string(path).map_err(|err| format!("无法读取本地令牌配置：{err}"))?;
    if text.trim().is_empty() {
        return Ok(TokenDisk::default());
    }
    serde_json::from_str(&text).map_err(|_| "本地令牌配置无法识别。".to_string())
}

fn write_disk(path: &Path, disk: &TokenDisk) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(disk).map_err(|_| "无法序列化本地令牌配置。".to_string())?;
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|err| format!("无法写入本地令牌配置：{err}"))?;
    file.write_all(&data)
        .map_err(|err| format!("无法写入本地令牌配置：{err}"))?;
    restrict_permissions(path);
    Ok(())
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_fallback_roundtrip_does_not_require_keyring() {
        let dir = std::env::temp_dir().join(format!("gteam-secrets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("git-access-tokens.json");
        let secret = "ghp_file_only_secret_value";
        file_set(&path, "170000-1", secret).unwrap();
        assert_eq!(file_get(&path, "170000-1").as_deref(), Some(secret));
        file_remove(&path, "170000-1").unwrap();
        assert!(file_get(&path, "170000-1").is_none());
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(!text.contains(secret));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
