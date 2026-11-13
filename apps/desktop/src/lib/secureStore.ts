/**
 * 安全存储 - 使用 Tauri Store 插件
 * Token 等敏感信息安全存储
 */

import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('gteam-secure.json', { autoSave: true });
  }
  return store;
}

export interface SecureTokenData {
  serverUrl: string;
  token: string;
  expiresAt?: number;
}

/**
 * 保存 token
 */
export async function saveToken(serverUrl: string, token: string, expiresAt?: number): Promise<void> {
  const s = await getStore();
  const tokens = (await s.get<Record<string, SecureTokenData>>('tokens')) || {};
  tokens[serverUrl] = { serverUrl, token, expiresAt };
  await s.set('tokens', tokens);
  await s.save();
}

/**
 * 获取 token
 */
export async function getToken(serverUrl: string): Promise<string | null> {
  const s = await getStore();
  const tokens = (await s.get<Record<string, SecureTokenData>>('tokens')) || {};
  const tokenData = tokens[serverUrl];
  
  if (!tokenData) return null;
  
  // 检查是否过期
  if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
    await removeToken(serverUrl);
    return null;
  }
  
  return tokenData.token;
}

/**
 * 删除 token
 */
export async function removeToken(serverUrl: string): Promise<void> {
  const s = await getStore();
  const tokens = (await s.get<Record<string, SecureTokenData>>('tokens')) || {};
  delete tokens[serverUrl];
  await s.set('tokens', tokens);
  await s.save();
}

/**
 * 获取所有 token
 */
export async function getAllTokens(): Promise<Record<string, SecureTokenData>> {
  const s = await getStore();
  return (await s.get<Record<string, SecureTokenData>>('tokens')) || {};
}

/**
 * 清除所有 token
 */
export async function clearAllTokens(): Promise<void> {
  const s = await getStore();
  await s.set('tokens', {});
  await s.save();
}
