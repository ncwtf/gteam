import { useState } from 'react';
import { useStore, createApiClient } from '../store';
import { DocumentPartition, MemberRole } from '@teamctx/shared';

interface CreateDocumentModalProps {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateDocumentModal({ projectId, onClose, onSuccess }: CreateDocumentModalProps) {
  const { getActiveConnection } = useStore();
  const activeConnection = getActiveConnection();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [partition, setPartition] = useState<DocumentPartition>(DocumentPartition.Collaborative);
  const [role, setRole] = useState<MemberRole>(MemberRole.Other);
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnection) return;

    setError('');
    setLoading(true);

    try {
      const api = createApiClient(activeConnection);
      await api.post('/api/documents', {
        projectId,
        title,
        content,
        partition,
        metadata: {
          projectId,
          ownerId: activeConnection.userId,
          role,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean)
        }
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || '创建失败');
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
        maxWidth: '700px',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0 }}>新建文档</h2>
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
            />
          </div>

          <div className="form-group">
            <label>分区 *</label>
            <select value={partition} onChange={(e) => setPartition(e.target.value as DocumentPartition)} required>
              <option value={DocumentPartition.Personal}>个人 (只有你可以编辑)</option>
              <option value={DocumentPartition.Shared}>共享 (团队只读)</option>
              <option value={DocumentPartition.Collaborative}>协作 (团队可编辑)</option>
            </select>
          </div>

          <div className="form-group">
            <label>角色</label>
            <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
              <option value={MemberRole.UI}>UI</option>
              <option value={MemberRole.Product}>产品</option>
              <option value={MemberRole.Backend}>后端</option>
              <option value={MemberRole.Frontend}>前端</option>
              <option value={MemberRole.FullStack}>全栈</option>
              <option value={MemberRole.Other}>其他</option>
            </select>
          </div>

          <div className="form-group">
            <label>标签 (逗号分隔)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="api, 架构, 需求"
            />
          </div>

          <div className="form-group">
            <label>内容 (Markdown) *</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              style={{ minHeight: '300px', fontFamily: 'monospace' }}
              placeholder="# 标题&#10;&#10;文档内容..."
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              取消
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? '创建中...' : '创建文档'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateDocumentModal;
