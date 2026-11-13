import { useState } from 'react';
import { useStore, createApiClient } from '../store';
import { apiErrorMessage } from '../lib/apiError';

interface CreateProjectModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function CreateProjectModal({ onClose, onSuccess }: CreateProjectModalProps) {
  const { getActiveConnection } = useStore();
  const activeConnection = getActiveConnection();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) {
      setError('没有可用的团队连接');
      return;
    }
    if (!name.trim()) {
      setError('项目名称不能为空');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const api = createApiClient(activeConnection);
      await api.post('/api/projects', {
        name: name.trim(),
        description: description.trim() || undefined,
        gitRepoUrl: gitRepoUrl.trim() || undefined
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(apiErrorMessage(err, '创建项目失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
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
          <button onClick={onClose} style={{ fontSize: '24px', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>项目名称 *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>

          <div className="form-group">
            <label>描述</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: '100px' }} />
          </div>

          <div className="form-group">
            <label>Git 仓库地址（可选）</label>
            <input
              type="text"
              value={gitRepoUrl}
              onChange={(e) => setGitRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">取消</button>
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
