/**
 * 升级前可能还留着令牌的位置：
 * - zustand persist：`gteam-storage`，更早的桌面端用 `teamctx-storage`
 * - Tauri Store 插件：`gteam-secure.json` 里的 `tokens`
 * 这两处都不是系统密钥链。能读到未过期的令牌时，启动时搬进密钥链。
 */

export interface LegacyToken {
  serverUrl: string;
  token: string;
  email?: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
}

const LEGACY_STORAGE_KEYS = ['teamctx-storage', 'gteam-storage'] as const;

export function canonicalServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function safeLocalStorage(): KeyValueStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function decodeBase64Url(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = globalThis.atob(normalized + pad);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 只读 JWT 载荷里的邮箱，不校验签名。搬迁旧令牌时用来补上登录框。 */
export function emailFromJwt(token: string): string | undefined {
  const segment = token.split('.')[1];
  if (!segment) return undefined;
  try {
    const payload = JSON.parse(decodeBase64Url(segment)) as { email?: unknown };
    if (typeof payload.email !== 'string') return undefined;
    const email = payload.email.trim();
    return email || undefined;
  } catch {
    return undefined;
  }
}

export function tokensInPersistedJson(raw: string | null): LegacyToken[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const root = parsed as Record<string, unknown>;
  const state = root.state && typeof root.state === 'object'
    ? root.state as Record<string, unknown>
    : root;
  if (!Array.isArray(state.connections)) return [];

  const tokens: LegacyToken[] = [];
  for (const item of state.connections) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const serverUrl = typeof record.serverUrl === 'string' ? record.serverUrl.trim() : '';
    const token = typeof record.token === 'string' ? record.token.trim() : '';
    if (!serverUrl || !token) continue;
    const storedEmail = typeof record.email === 'string' ? record.email.trim() : '';
    tokens.push({
      serverUrl,
      token,
      email: storedEmail || emailFromJwt(token)
    });
  }
  return tokens;
}

export interface SecureTokenRecord {
  serverUrl?: string;
  token?: string;
  expiresAt?: number;
}

export function tokenFromSecureRecord(record: SecureTokenRecord, now = Date.now()): LegacyToken | null {
  const serverUrl = record.serverUrl?.trim() || '';
  const token = record.token?.trim() || '';
  if (!serverUrl || !token) return null;
  if (typeof record.expiresAt === 'number' && now > record.expiresAt) return null;
  return { serverUrl, token, email: emailFromJwt(token) };
}

/** 后读到的 `gteam-storage` 覆盖同地址的旧 `teamctx-storage`。 */
export function captureLegacyTokens(storage: KeyValueStore | null): LegacyToken[] {
  if (!storage) return [];
  const found = new Map<string, LegacyToken>();
  for (const key of LEGACY_STORAGE_KEYS) {
    for (const token of tokensInPersistedJson(storage.getItem(key))) {
      found.set(canonicalServerUrl(token.serverUrl), token);
    }
  }
  return [...found.values()];
}

export function findLegacyToken(tokens: LegacyToken[], serverUrl: string): LegacyToken | undefined {
  const key = canonicalServerUrl(serverUrl);
  return tokens.find((item) => canonicalServerUrl(item.serverUrl) === key);
}

export function reloginPrefill(connection: {
  serverUrl: string;
  email?: string | null;
  userName?: string | null;
}): { serverUrl: string; email: string } {
  const serverUrl = connection.serverUrl;
  const email = connection.email?.trim() || '';
  if (email) return { serverUrl, email };
  const name = connection.userName?.trim() || '';
  if (name.includes('@')) return { serverUrl, email: name };
  return { serverUrl, email: '' };
}
