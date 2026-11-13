import axios from 'axios';

function readServerError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const message = (data as { error?: unknown }).error;
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  return trimmed || null;
}

/** 把接口失败转成给用户看的文字。永远不要只打日志。 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const serverError = readServerError(err.response?.data);
    if (serverError) return serverError;
    if (!err.response) {
      return err.message ? `${fallback}：${err.message}` : fallback;
    }
    return `${fallback}（HTTP ${err.response.status}）`;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

/** 连接自托管服务器时，404 且没有业务错误体通常表示服务端版本过旧。 */
export function getConnectionError(err: unknown, fallback = '无法连接服务器，请检查地址和端口'): string {
  if (axios.isAxiosError(err)) {
    const serverError = readServerError(err.response?.data);
    if (serverError) return serverError;
    if (err.response?.status === 404) {
      return '服务器版本过旧，不支持此操作，请在服务器上重新运行安装脚本更新';
    }
  }
  return getApiErrorMessage(err, fallback);
}
