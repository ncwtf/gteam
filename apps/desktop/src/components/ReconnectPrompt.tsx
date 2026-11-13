import { useState } from 'react';
import axios from 'axios';
import { normalizeServerUrl, TeamConnection } from '@gteam/shared';
import { getConnectionError } from '../lib/apiError';
import { reloginPrefill } from '../lib/legacySession';
import { rememberToken } from '../lib/session';
import { useStore } from '../store';

interface ReconnectPromptProps {
  connection: TeamConnection;
}

function ReconnectPrompt({ connection }: ReconnectPromptProps) {
  const prefill = reloginPrefill(connection);
  const [email, setEmail] = useState(prefill.email);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { updateConnection, setTokenRestore, setSessionNotice } = useStore();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const serverUrl = normalizeServerUrl(prefill.serverUrl);
      const response = await axios.post(`${serverUrl}/api/auth/login`, { email, password });
      if (!response.data.success) {
        setError(response.data.error || '登录失败');
        return;
      }
      const { user, token } = response.data.data;
      const teamResponse = await axios.get(`${serverUrl}/api/auth/team-info`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (teamResponse.data?.success === false || !teamResponse.data?.data?.id) {
        throw new Error(teamResponse.data?.error || '未找到团队');
      }
      const team = teamResponse.data.data;
      const warning = await rememberToken(serverUrl, token);
      updateConnection(connection.id, {
        serverUrl,
        token,
        email: user.email || email,
        userId: user.id,
        userName: user.name,
        teamName: team.name || connection.teamName,
        teamId: team.id,
        isAdmin: Boolean(team.isAdmin)
      });
      setTokenRestore(connection.id, 'ready');
      if (warning) setSessionNotice(warning);
    } catch (err: unknown) {
      setError(getConnectionError(err, '无法连接服务器，请检查地址和端口'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <h1 className="card-title">重新登录</h1>
      <p className="card-content" style={{ marginBottom: 16 }}>
        {connection.teamName} 的登录状态已失效，暂时不能加载项目。输入密码后即可继续使用这个团队。
        {prefill.email
          ? '服务器地址和邮箱已经填好。'
          : '服务器地址已经填好，请填写登录邮箱。'}
      </p>
      {connection.userName && (
        <p className="card-content" style={{ marginBottom: 16 }}>当前账号：{connection.userName}</p>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="relogin-server">服务器</label>
          <input id="relogin-server" type="text" value={prefill.serverUrl} readOnly />
        </div>
        <div className="form-group">
          <label htmlFor="relogin-email">邮箱</label>
          <input
            id="relogin-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="relogin-password">密码</label>
          <input
            id="relogin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}

export default ReconnectPrompt;
