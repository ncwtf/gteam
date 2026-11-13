use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "com.gteam.desktop";

/// keyring 2.3.3 的 Windows 实现用 `CredReadW` / `CredDeleteW`。
/// 凭据不存在时 API 返回失败，`GetLastError()` 为 `ERROR_NOT_FOUND` (1168)，
/// `windows.rs` 的 `decode_error` 把它映射成 `Error::NoEntry`
/// （Display：`No matching entry found in secure storage`）。
/// 删除一个本来就不存在的条目应当成功：登录状态已经不在密钥链里。
fn is_missing_keyring_entry(err: &keyring::Error) -> bool {
    match err {
        keyring::Error::NoEntry => true,
        other => {
            let text = other.to_string().to_ascii_lowercase();
            text.contains("no matching entry")
                || text.contains("error_not_found")
                || text.contains("element not found")
                || text.contains("noentry")
                || text.contains("error code 1168")
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamToken {
    pub server_url: String,
    pub token: String,
}

/// 将团队令牌存储到系统 keyring
#[tauri::command]
pub fn store_team_token(server_url: String, token: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &server_url)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to store token: {}", e))?;

    Ok(())
}

/// 从系统 keyring 获取团队令牌
#[tauri::command]
pub fn get_team_token(server_url: String) -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, &server_url)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.get_password() {
        Ok(token) => Ok(token),
        Err(err) if is_missing_keyring_entry(&err) => {
            Err("No matching entry found in secure storage".to_string())
        }
        Err(err) => Err(format!("Failed to retrieve token: {}", err)),
    }
}

/// 删除团队令牌
#[tauri::command]
pub fn delete_team_token(server_url: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &server_url)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(err) if is_missing_keyring_entry(&err) => Ok(()),
        Err(err) => Err(format!("Failed to delete token: {}", err)),
    }
}

/// 获取所有存储的团队 URL（通过遍历）
/// 注意：keyring 不支持列出所有条目，需要通过其他方式维护列表
#[tauri::command]
pub fn list_stored_teams() -> Result<Vec<String>, String> {
    // keyring 库不支持枚举所有条目
    // 应用应该在其他地方（如 Store）维护团队列表
    // 这里返回空列表，实际使用时需要配合 Store 使用
    Ok(vec![])
}

#[cfg(test)]
mod tests {
    use super::is_missing_keyring_entry;

    #[test]
    fn missing_credential_is_not_a_delete_failure() {
        let missing = keyring::Error::NoEntry;
        assert!(is_missing_keyring_entry(&missing));
        assert_eq!(
            missing.to_string(),
            "No matching entry found in secure storage"
        );
    }
}
