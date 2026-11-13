/**
 * 团队服务器地址。桌面客户端只用这一个地址：
 * HTTP API 走原 URL，WebSocket 走同一主机的 /ws，https 自动换成 wss。
 */
export function toWebSocketUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  const scheme = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  let base: string;
  if (!scheme) {
    base = `ws://${trimmed}`;
  } else {
    const name = scheme[1].toLowerCase();
    const rest = trimmed.slice(scheme[0].length);
    if (name === 'https' || name === 'wss') base = `wss://${rest}`;
    else if (name === 'http' || name === 'ws') base = `ws://${rest}`;
    else base = `ws://${rest}`;
  }
  return base.endsWith('/ws') ? base : `${base}/ws`;
}
