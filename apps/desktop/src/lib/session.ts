import { getApiErrorMessage, readErrorText } from './apiError';
import { deletionFailure } from './keychainErrors';
import { deleteTeamToken, getTeamToken, storeTeamToken } from './keyring';
import {
  canonicalServerUrl,
  emailFromJwt,
  findLegacyToken,
  LegacyToken,
  tokenFromSecureRecord
} from './legacySession';
import { getAllTokens, removeToken } from './secureStore';

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(host.__TAURI_INTERNALS__ || host.__TAURI__);
}

export async function rememberToken(serverUrl: string, token: string): Promise<string | null> {
  if (!isTauri()) {
    return '当前环境无法写入系统密钥链，重启应用后需要重新登录';
  }
  try {
    await storeTeamToken(serverUrl, token);
    return null;
  } catch (error) {
    return getApiErrorMessage(error, '登录令牌未能写入系统密钥链，重启应用后需要重新登录');
  }
}

export type RestoredSession =
  | { status: 'missing'; notice: string | null }
  | { status: 'ready'; token: string; email?: string; notice: string | null };

async function readSecureToken(serverUrl: string): Promise<(LegacyToken & { storageKey: string }) | null> {
  if (!isTauri()) return null;
  try {
    const all = await getAllTokens();
    const wanted = canonicalServerUrl(serverUrl);
    for (const [storageKey, record] of Object.entries(all)) {
      const candidate = canonicalServerUrl(record.serverUrl || storageKey);
      if (candidate !== wanted) continue;
      const parsed = tokenFromSecureRecord({ ...record, serverUrl: record.serverUrl || storageKey });
      if (!parsed) {
        await removeToken(storageKey);
        return null;
      }
      return { ...parsed, storageKey };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 先用内存或旧存储里还在的令牌，并写入密钥链；没有的话再读密钥链。
 * 密钥链里没有条目时返回 missing，调用方显示重新登录，而不是拿空令牌去请求接口。
 */
export async function restoreConnection(
  connection: { serverUrl: string; token?: string; email?: string },
  legacy: LegacyToken[]
): Promise<RestoredSession> {
  const inline = connection.token?.trim() || '';
  const saved = findLegacyToken(legacy, connection.serverUrl);
  let token = inline || saved?.token || '';
  let email = connection.email?.trim() || saved?.email || '';
  let source: 'existing' | 'secure-store' | 'keychain' = token ? 'existing' : 'keychain';
  let secureStorageKey = '';

  if (!token) {
    const secure = await readSecureToken(connection.serverUrl);
    if (secure) {
      token = secure.token;
      email = email || secure.email || '';
      source = 'secure-store';
      secureStorageKey = secure.storageKey;
    }
  }

  if (!token && isTauri()) {
    try {
      token = (await getTeamToken(connection.serverUrl)).trim();
      source = 'keychain';
    } catch (error) {
      if (!isMissingEntry(error)) {
        return {
          status: 'missing',
          notice: readErrorText(error) || '无法读取系统密钥链，请重新登录'
        };
      }
    }
  }

  if (!token) return { status: 'missing', notice: null };
  email = email || emailFromJwt(token) || '';

  let notice: string | null = null;
  if (source !== 'keychain') {
    notice = await rememberToken(connection.serverUrl, token);
    if (!notice && isTauri()) {
      const keys = new Set([connection.serverUrl, secureStorageKey].filter((key) => key));
      for (const key of keys) {
        try {
          await removeToken(key);
        } catch {
          // 明文副本删不掉时，密钥链里已经有令牌，下次仍从密钥链恢复。
        }
      }
    }
  }

  return {
    status: 'ready',
    token,
    email: email || undefined,
    notice
  };
}

function isMissingEntry(error: unknown): boolean {
  return deletionFailure(error) === null;
}

/** 找不到条目视为已经删除。其他失败把原因返回给界面，但不应拦住断开团队。 */
export async function forgetToken(serverUrl: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    await deleteTeamToken(serverUrl);
    return null;
  } catch (error) {
    return deletionFailure(error);
  }
}
