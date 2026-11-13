/** 把 axios / 网络错误转成给用户看的中文提示，避免错误被吞掉 */
export function apiErrorMessage(err: any, fallback = '操作失败'): string {
  const status: number | undefined = err?.response?.status;
  const serverMsg: string | undefined = err?.response?.data?.error;
  if (serverMsg) return serverMsg;
  if (status === 401 || status === 403) return '登录已失效，请点击左侧「+」用同一服务器和账号重新登录';
  if (status === 404) return '服务器版本过旧，不支持此操作，请在服务器上重新运行安装脚本更新';
  if (status && status >= 500) return `服务器错误（${status}），请稍后重试`;
  if (err?.request && !err?.response) return '无法连接服务器，请检查网络和服务器地址';
  return err?.message || fallback;
}
