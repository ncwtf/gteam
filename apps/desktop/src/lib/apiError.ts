import axios from 'axios';

function readableServerError(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 200) return null;
  if (/<[a-z][\s\S]*>/i.test(text)) return null;
  return text;
}

/** 把接口或网络错误转成可直接展示的中文。 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown; message?: unknown } | undefined;
    const serverError = readableServerError(data?.error) || readableServerError(data?.message);
    if (serverError) return serverError;
    if (!error.response) return '无法连接服务器，请检查地址和网络';
    if (error.response.status === 401) return '登录已失效，请重新连接团队';
    if (error.response.status === 403) return '没有权限执行此操作';
    if (error.response.status === 404) return '请求的资源不存在';
    return `${fallback}（${error.response.status}）`;
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}
