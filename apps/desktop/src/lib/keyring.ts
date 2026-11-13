/**
 * Keyring 接口 - OS 系统密钥链存储
 * 用于安全存储团队令牌
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * 存储团队令牌到系统 keyring
 */
export async function storeTeamToken(serverUrl: string, token: string): Promise<void> {
  await invoke('store_team_token', { serverUrl, token });
}

/**
 * 从系统 keyring 获取团队令牌
 */
export async function getTeamToken(serverUrl: string): Promise<string> {
  return await invoke('get_team_token', { serverUrl });
}

/**
 * 删除团队令牌
 */
export async function deleteTeamToken(serverUrl: string): Promise<void> {
  await invoke('delete_team_token', { serverUrl });
}

/**
 * 获取所有存储的团队 URL
 * 注意：keyring 不支持枚举，需要配合 Store 使用
 */
export async function listStoredTeams(): Promise<string[]> {
  return await invoke('list_stored_teams');
}
