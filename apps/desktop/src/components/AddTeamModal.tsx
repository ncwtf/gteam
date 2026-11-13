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
  const [mode, setMode] = useState<'login' | 'invite'>('login');

  const { addConnection } = useStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 确保 URL 格式正确
      const normalizedUrl = serverUrl.replace(/\/$/, '');
      
      // 登录获取 token
      const response = await axios.post(`${normalizedUrl}/api/auth/login`, {
        email,
        password
      });

      if (response.data.success) {
        const { user, token } = response.data.data;
        
        // 获取团队信息
        const teamResponse = await axios.get(`${normalizedUrl}/api/teams/current`, {
          headers: { Authorization: `Bearer ${token}` }
        });

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
      setError(err.response?.data?.error || '网络错误');
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
      if (serverUrl.startsWith('gteam://')) {
        const url = new URL(serverUrl);
        parsedServerUrl = `https://${url.hostname}${url.port ? ':' + url.port : ''}`;
        parsedInviteCode = url.searchParams.get('invite') || url.pathname.replace('/', '');
      }

      parsedServerUrl = parsedServerUrl.replace(/\/$/, '');

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
      setError(err.response?.data?.error || '网络错误');
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
        </div>

        {error && <div className="error">{error}</div>}

        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>团队服务器 URL</label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://team.example.com"
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
