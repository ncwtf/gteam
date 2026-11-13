import { getApiErrorMessage } from './apiError';
import { deleteTeamToken, getTeamToken, storeTeamToken } from './keyring';

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

export async function restoreToken(serverUrl: string): Promise<string | null> {
  if (!isTauri()) return null;
  return getTeamToken(serverUrl);
}

/** 找不到条目视为已经删除。其他失败把原因返回给界面。 */
export async function forgetToken(serverUrl: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    await deleteTeamToken(serverUrl);
    return null;
  } catch (error) {
    const message = getApiErrorMessage(error, '删除登录状态失败');
    if (/noentry|no entry|not found|no matching|没有|不存在/i.test(message)) return null;
    return message;
  }
}
