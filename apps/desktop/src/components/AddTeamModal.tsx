import { useState } from 'react';
import axios from 'axios';
import { useStore } from '../store';
import { TeamConnection } from '@gteam/shared';

interface AddTeamModalProps {
  onClose: () => void;
}

function AddTeamModal({ onClose }: AddTeamModalProps) {
  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'invite' | 'setup'>('login');
  const [teamName, setTeamName] = useState('');
  const [userName, setUserName] = useState('');

  const { addConnection } = useStore();

  // 补全协议、去掉末尾斜杠
  const normalizeUrl = (raw: string) => {
    let u = raw.trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
    return u;
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const normalizedUrl = normalizeUrl(serverUrl);
      const response = await axios.post(`${normalizedUrl}/api/auth/setup`, {
        teamName,
        name: userName || undefined,
        email,
        password
      });
      if (response.data.success) {
        const { user, token, teamName: createdTeam } = response.data.data;
        addConnection({
          id: `${normalizedUrl}-${user.id}`,
          serverUrl: normalizedUrl,
          teamName: createdTeam || teamName,
          token,
          userId: user.id,
          userName: user.name,
          isActive: false,
          joinedAt: new Date()
        });
        onClose();
      } else {
        setError(response.data.error || '创建失败');
      }
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
          (err.response?.status === 404
            ? '服务器版本过旧，不支持此操作，请在服务器上重新运行安装脚本更新'
            : '无法连接服务器，请检查地址和端口')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 确保 URL 格式正确
      const normalizedUrl = normalizeUrl(serverUrl);
      
      // 登录获取 token
      const response = await axios.post(`${normalizedUrl}/api/auth/login`, {
        email,
        password
      });

      if (response.data.success) {
        const { user, token } = response.data.data;
        
        // 获取团队信息
        const teamResponse = await axios
          .get(`${normalizedUrl}/api/auth/team-info`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          .catch(() => ({ data: { data: null } }));

        const connection: TeamConnection = {
          id: `${normalizedUrl}-${user.id}`,
          serverUrl: normalizedUrl,
          teamName: teamResponse.data.data?.name || 'Team',
          token,
          userId: user.id,
          userName: user.name,
          isActive: false,
          joinedAt: new Date()
        };

        addConnection(connection);
        onClose();
      } else {
        setError(response.data.error || '连接失败');
      }
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
          (err.response?.status === 404
            ? '服务器版本过旧，不支持此操作，请在服务器上重新运行安装脚本更新'
            : '无法连接服务器，请检查地址和端口')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleInviteJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 解析邀请链接或代码
      let parsedServerUrl = serverUrl;
      let parsedInviteCode = inviteCode;

      // 支持 gteam:// 深链接
      if (serverUrl.trim().startsWith('gteam://')) {
        const url = new URL(serverUrl.trim());
        const server = url.searchParams.get('server');
        parsedServerUrl = server
          ? server
          : `https://${url.hostname}${url.port ? ':' + url.port : ''}`;
        parsedInviteCode = url.searchParams.get('invite') || url.pathname.replace('/', '') || inviteCode;
      }

      parsedServerUrl = normalizeUrl(parsedServerUrl);

      // 使用邀请码注册/加入
      const response = await axios.post(`${parsedServerUrl}/api/auth/join-invite`, {
        inviteCode: parsedInviteCode,
        email,
        password
      });

      if (response.data.success) {
        const { user, token, teamName } = response.data.data;

        const connection: TeamConnection = {
          id: `${parsedServerUrl}-${user.id}`,
          serverUrl: parsedServerUrl,
          teamName: teamName || 'Team',
          token,
          userId: user.id,
          userName: user.name,
          isActive: false,
          joinedAt: new Date()
        };

        addConnection(connection);
        onClose();
      } else {
        setError(response.data.error || '加入失败');
      }
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
          (err.response?.status === 404
            ? '服务器版本过旧，不支持此操作，请在服务器上重新运行安装脚本更新'
            : '无法连接服务器，请检查地址和端口')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 9999
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '32px',
        width: '90%',
        maxWidth: '500px',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0 }}>添加团队</h2>
          <button onClick={onClose} style={{ fontSize: '24px', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          <button
            className={mode === 'login' ? 'btn' : 'btn btn-secondary'}
            onClick={() => setMode('login')}
          >
            已有账号登录
          </button>
          <button
            className={mode === 'invite' ? 'btn' : 'btn btn-secondary'}
            onClick={() => setMode('invite')}
          >
            使用邀请码
          </button>
          <button
            className={mode === 'setup' ? 'btn' : 'btn btn-secondary'}
            onClick={() => setMode('setup')}
          >
            新服务器创建团队
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {mode === 'setup' ? (
          <form onSubmit={handleSetup}>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 0 }}>
              仅适用于刚部署、还没有任何账号的服务器。你会成为团队管理员，之后可在设置里生成邀请码邀请队友。
            </p>
            <div className="form-group">
              <label>团队服务器 URL</label>
              <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="http://your.server:3000" required />
            </div>
            <div className="form-group">
              <label>团队名称</label>
              <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>你的昵称</label>
              <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="可选" />
            </div>
            <div className="form-group">
              <label>邮箱</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>设置密码（至少 8 位）</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            </div>
            <button type="submit" className="btn" disabled={loading} style={{ width: '100%' }}>
              {loading ? '创建中...' : '创建团队'}
            </button>
          </form>
        ) : mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>团队服务器 URL</label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://your.server:3000"
                required
              />
            </div>
            
            <div className="form-group">
              <label>邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            
            <div className="form-group">
              <label>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            <button type="submit" className="btn" disabled={loading} style={{ width: '100%' }}>
              {loading ? '连接中...' : '连接团队'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleInviteJoin}>
            <div className="form-group">
              <label>邀请链接或服务器 URL</label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="gteam://team.example.com?invite=abc123 或 https://team.example.com"
                required
              />
              <small style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                支持 gteam:// 深链接
              </small>
            </div>
            
            <div className="form-group">
              <label>邀请码（如果链接未包含）</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="abc123"
              />
            </div>
            
            <div className="form-group">
              <label>邮箱（用于注册）</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            
            <div className="form-group">
              <label>设置密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            <button type="submit" className="btn" disabled={loading} style={{ width: '100%' }}>
              {loading ? '加入中...' : '加入团队'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default AddTeamModal;
