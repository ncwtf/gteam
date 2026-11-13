import { useState } from 'react';
import { Project } from '@gteam/shared';
import { createApiClient, useStore } from '../store';
import { apiErrorMessage } from '../lib/apiError';
import { normalizeProject, normalizeTeam } from '../lib/normalize';

interface CreateProjectModalProps {
  onClose: () => void;
  onSuccess: (project: Project) => void;
}

function CreateProjectModal({ onClose, onSuccess }: CreateProjectModalProps) {
  const { getActiveConnection, updateConnection } = useStore();
  const activeConnection = getActiveConnection();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const resolveTeamId = async () => {
    if (!activeConnection) throw new Error('未选择团队');
    if (!activeConnection.token) throw new Error('登录已失效，请重新连接团队');
    if (activeConnection.teamId) return activeConnection.teamId;

    const api = createApiClient(activeConnection);
    const response = await api.get('/api/auth/team-info');
    if (!response.data?.success || !response.data.data?.id) {
      throw new Error(response.data?.error || '获取团队信息失败');
    }
    const team = normalizeTeam(response.data.data);
    if (!team.id) throw new Error('获取团队信息失败');
    updateConnection(activeConnection.id, {
      teamId: team.id,
      teamName: team.name || activeConnection.teamName,
      ...(typeof team.isAdmin === 'boolean' ? { isAdmin: team.isAdmin } : {})
    });
    return team.id;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) {
      setError('未选择团队');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const teamId = await resolveTeamId();
      const api = createApiClient(activeConnection);
      const response = await api.post('/api/projects', {
        teamId,
        name: name.trim(),
        description: description.trim() || undefined,
        gitRepoUrl: gitRepoUrl.trim() || undefined
      });
      if (!response.data?.success || !response.data.data) {
        setError(response.data?.error || '创建项目失败');
        return;
      }
      onSuccess(normalizeProject(response.data.data));
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, '创建项目失败'));
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
        maxWidth: '560px',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0 }}>新建项目</h2>
          <button type="button" onClick={onClose} style={{ fontSize: '24px', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {activeConnection?.isAdmin === false && (
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 0 }}>
            只有团队管理员可以创建项目。如果提交失败，请联系管理员。
          </p>
        )}

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>项目名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              maxLength={255}
              placeholder="例如：客户端"
            />
          </div>

          <div className="form-group">
            <label>描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个项目做什么"
            />
          </div>

          <div className="form-group">
            <label>Git 仓库 URL（可选）</label>
            <input
              type="text"
              value={gitRepoUrl}
              onChange={(e) => setGitRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              maxLength={500}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              取消
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? '创建中...' : '创建项目'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateProjectModal;
