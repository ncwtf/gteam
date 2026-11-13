import { useState } from 'react';
import { useStore, createApiClient } from '../store';
import { apiErrorMessage } from '../lib/apiError';

interface CreateIssueModalProps {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateIssueModal({ projectId, onClose, onSuccess }: CreateIssueModalProps) {
  const { getActiveConnection } = useStore();
  const activeConnection = getActiveConnection();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) {
      setError('没有可用的团队连接');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const api = createApiClient(activeConnection);
      await api.post('/api/issues', {
        projectId,
        title,
        description,
        priority,
        createdByAI: false
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(apiErrorMessage(err, '创建失败'));
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
          <h2 style={{ margin: 0 }}>新建问题</h2>
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
              placeholder="遇到的问题或需要讨论的内容"
            />
          </div>

          <div className="form-group">
            <label>优先级</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as any)}>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </div>

          <div className="form-group">
            <label>描述 *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              style={{ minHeight: '200px' }}
              placeholder="详细描述问题、复现步骤、期望结果等..."
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              取消
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? '创建中...' : '创建问题'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateIssueModal;
