import { readErrorText } from './apiError';

/**
 * keyring 2.3.3 在 Windows 上删除或读取不存在的凭据时，
 * `CredDeleteW` / `CredReadW` 失败且 `GetLastError()` 为 `ERROR_NOT_FOUND` (1168)，
 * `decode_error` 把它收成 `Error::NoEntry`。
 * 这条错误的 Display 是 `No matching entry found in secure storage`。
 * 若被包进 `PlatformFailure`，内层文字是 `Windows ERROR_NOT_FOUND`。
 * Tauri 命令失败时，前端拿到的经常是字符串而不是 Error 对象。
 */
export function isMissingKeychainError(error: unknown): boolean {
  const text = readErrorText(error).toLowerCase();
  if (!text) return false;
  return /noentry|no entry|no matching entry|not found|error_not_found|element not found|error code 1168|没有找到|不存在|未找到/.test(text);
}

/** 密钥链里本来就没有条目时返回 null。其他失败返回给界面的文字。 */
export function deletionFailure(error: unknown, fallback = '删除登录状态失败'): string | null {
  if (isMissingKeychainError(error)) return null;
  return readErrorText(error) || fallback;
}
