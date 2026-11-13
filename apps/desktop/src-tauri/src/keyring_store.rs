use keyring::Entry;
use serde::{Serialize, Deserialize};

const SERVICE_NAME: &str = "com.gteam.desktop";

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
    
    entry
        .get_password()
        .map_err(|e| format!("Failed to retrieve token: {}", e))
}

/// 删除团队令牌
#[tauri::command]
pub fn delete_team_token(server_url: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &server_url)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    
    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete token: {}", e))?;
    
    Ok(())
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
