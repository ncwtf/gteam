import { useState } from 'react';
import { useStore, createApiClient } from '../store';
import { apiErrorMessage } from '../lib/apiError';

interface CreateRequirementModalProps {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateRequirementModal({ projectId, onClose, onSuccess }: CreateRequirementModalProps) {
  const { getActiveConnection } = useStore();
  const activeConnection = getActiveConnection();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) {
      setError('未选择团队');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const api = createApiClient(activeConnection);
      const response = await api.post('/api/requirements', {
        projectId,
        title: title.trim(),
        description: description.trim(),
        gitBranch: gitBranch.trim(),
        gitRepoUrl: gitRepoUrl.trim() || undefined
      });
      if (!response.data?.success) {
        setError(response.data?.error || '创建需求失败');
        return;
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, '创建需求失败'));
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
        maxWidth: '600px',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0 }}>新建需求</h2>
          <button onClick={onClose} style={{ fontSize: '24px', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>标题 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
              placeholder="实现用户登录功能"
            />
          </div>

          <div className="form-group">
            <label>描述 *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              style={{ minHeight: '150px' }}
              placeholder="详细描述需求内容..."
            />
          </div>

          <div className="form-group">
            <label>Git 分支 *</label>
            <input
              type="text"
              value={gitBranch}
              onChange={(e) => setGitBranch(e.target.value)}
              required
              placeholder="feature/user-login"
            />
            <small style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
              该需求绑定的 Git 分支名称
            </small>
          </div>

          <div className="form-group">
            <label>Git 仓库 URL (可选)</label>
            <input
              type="text"
              value={gitRepoUrl}
              onChange={(e) => setGitRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              取消
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? '创建中...' : '创建需求'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateRequirementModal;
