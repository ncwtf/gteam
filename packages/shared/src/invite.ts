export interface ParsedInvite {
  serverUrl: string;
  inviteCode: string;
}

/** 补全协议并去掉末尾斜杠。未写协议时按 http 处理，方便局域网地址。 */
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

function parseQuery(search: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!search) return params;
  for (const part of search.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
    const value = decodeURIComponent((eq === -1 ? '' : part.slice(eq + 1)).replace(/\+/g, ' '));
    params[key] = value;
  }
  return params;
}

/**
 * 解析「添加团队」里的服务器地址或邀请链接。
 * 支持：
 * - http(s)://host:port
 * - gteam://join?server=<url>&invite=<code>
 * - gteam://host:port?invite=<code>
 * - gteam://host/code
 */
export function parseInviteTarget(serverInput: string, inviteCodeInput = ''): ParsedInvite {
  const raw = serverInput.trim();
  const fallbackCode = inviteCodeInput.trim();

  if (!raw.toLowerCase().startsWith('gteam://')) {
    return { serverUrl: normalizeServerUrl(raw), inviteCode: fallbackCode };
  }

  const rest = raw.slice('gteam://'.length);
  const hashIndex = rest.indexOf('#');
  const withoutHash = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  const beforeQuery = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);
  const params = parseQuery(query);

  let inviteCode = (params.invite || fallbackCode).trim();
  let serverUrl = params.server ? normalizeServerUrl(params.server) : '';

  if (!serverUrl) {
    const slash = beforeQuery.indexOf('/');
    const hostPort = (slash === -1 ? beforeQuery : beforeQuery.slice(0, slash)).trim();
    const path = slash === -1 ? '' : decodeURIComponent(beforeQuery.slice(slash + 1)).replace(/^\/+|\/+$/g, '');
    const host = hostPort.split(':')[0];
    if (host && host.toLowerCase() !== 'join') {
      serverUrl = normalizeServerUrl(hostPort);
    }
    if (!inviteCode && path && path.toLowerCase() !== 'join') {
      inviteCode = path;
    }
  }

  return { serverUrl, inviteCode };
}
