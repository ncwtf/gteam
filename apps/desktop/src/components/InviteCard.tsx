import { useState } from 'react';
import axios from 'axios';
import type { TeamConnection } from '@gteam/shared';

// 管理员生成邀请码；链接里带上客户端当前使用的服务器地址
function InviteCard({ connection }: { connection: TeamConnection }) {
  const [code, setCode] = useState('');
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const headers = { Authorization: `Bearer ${connection.token}` };

  const createInvite = async () => {
    setLoading(true);
    setMessage('');
    try {
      const team = await axios.get(`${connection.serverUrl}/api/auth/team-info`, { headers });
      const teamId = team.data?.data?.id;
      if (!teamId) throw new Error('未找到团队');
      const res = await axios.post(
        `${connection.serverUrl}/api/auth/create-invite`,
        { teamId, expiresInDays: 7 },
        { headers }
      );
      const c = res.data?.data?.code;
      setCode(c);
      setLink(`gteam://join?server=${encodeURIComponent(connection.serverUrl)}&invite=${c}`);
    } catch (err: any) {
      setMessage(err.response?.data?.error || err.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('已复制');
    } catch {
      setMessage('复制失败，请手动选择复制');
    }
  };

  return (
    <div style={{ marginTop: '16px', padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
      <strong>邀请队友</strong>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '8px 0' }}>
        仅团队管理员可生成，有效期 7 天。队友在「添加团队 → 使用邀请码」里粘贴链接，或填服务器地址和邀请码。
      </p>
      <button className="btn btn-secondary" onClick={createInvite} disabled={loading}>
        {loading ? '生成中...' : '生成邀请码'}
      </button>
      {code && (
        <div style={{ marginTop: '12px', fontSize: '13px', wordBreak: 'break-all' }}>
          <p>服务器：{connection.serverUrl}</p>
          <p>
            邀请码：<code>{code}</code>{' '}
            <button className="btn btn-secondary" onClick={() => copy(code)}>复制</button>
          </p>
          <p>
            邀请链接：<code>{link}</code>{' '}
            <button className="btn btn-secondary" onClick={() => copy(link)}>复制</button>
          </p>
        </div>
      )}
      {message && <p style={{ marginTop: '8px', fontSize: '13px' }}>{message}</p>}
    </div>
  );
}

export default InviteCard;
