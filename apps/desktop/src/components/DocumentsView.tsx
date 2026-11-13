import { useEffect, useState } from 'react';
import { useStore, createApiClient } from '../store';
import { DocumentPartition } from '@gteam/shared';
import CreateDocumentModal from './CreateDocumentModal';
import { apiErrorMessage } from '../lib/apiError';
import { formatDateTime, normalizeDocument } from '../lib/normalize';

function DocumentsView() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');
  const { getActiveConnection, teamData, activeConnectionId, resourceErrors, setDocuments } = useStore();
  const activeConnection = getActiveConnection();
  const documents = activeConnectionId ? teamData[activeConnectionId]?.documents || [] : [];
  const projects = activeConnectionId ? teamData[activeConnectionId]?.projects || [] : [];
  const projectsError = activeConnectionId ? resourceErrors[activeConnectionId]?.projects : undefined;
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [partition, setPartition] = useState<DocumentPartition | 'all'>('all');
  const effectiveProjectId = projects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : (projects[0]?.id ?? '');

  useEffect(() => {
    if (activeConnection && effectiveProjectId) {
      loadDocuments();
    }
  }, [activeConnectionId, effectiveProjectId, partition]);

  const loadDocuments = async () => {
    if (!activeConnection || !effectiveProjectId) return;

    try {
      const api = createApiClient(activeConnection);
      const params = new URLSearchParams({ projectId: effectiveProjectId });
      if (partition !== 'all') {
        params.append('partition', partition);
      }
      const response = await api.get(`/api/documents?${params}`);
      if (!response.data?.success || !Array.isArray(response.data.data)) {
        setError(response.data?.error || '加载文档失败');
        return;
      }
      setDocuments(activeConnection.id, response.data.data.map(normalizeDocument));
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, '加载文档失败'));
    }
  };

  if (!activeConnection) {
    return <div className="loading">加载中...</div>;
  }

  if (projects.length === 0) {
    return (
      <div>
        <div className="header">
          <h1>文档</h1>
        </div>
        {projectsError ? (
          <div className="error">{projectsError}</div>
        ) : (
          <div className="card">
            <p style={{ color: 'var(--text-secondary)' }}>请先创建一个项目</p>
          </div>
        )}
      </div>
    );
  }

  const preview = (content: string) => {
    const text = content || '';
    return text.length > 200 ? `${text.slice(0, 200)}...` : text || '暂无内容';
  };

  return (
    <div>
      <div className="header">
        <h1>文档</h1>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (!effectiveProjectId) {
              setError('请先选择项目');
              return;
            }
            setShowCreateModal(true);
          }}
        >
          新建文档
        </button>
      </div>

      {error && (
        <div className="error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{error}</span>
          <button type="button" className="btn btn-secondary" onClick={loadDocuments}>重试</button>
        </div>
      )}
      
      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px' }}>
        <select
          value={effectiveProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        
        <select
          value={partition}
          onChange={(e) => setPartition(e.target.value as DocumentPartition | 'all')}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
        >
          <option value="all">全部分区</option>
          <option value={DocumentPartition.Personal}>个人</option>
          <option value={DocumentPartition.Shared}>共享（只读）</option>
          <option value={DocumentPartition.Collaborative}>协作</option>
        </select>
      </div>
      
      {documents.length === 0 && !error ? (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>暂无文档</p>
        </div>
      ) : (
        documents.map((doc) => (
          <div key={doc.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <div className="card-title">{doc.title}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  分区: {doc.partition} | 更新: {formatDateTime(doc.updatedAt) || '未知'}
                </div>
              </div>
              <span style={{
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                backgroundColor: doc.partition === 'collaborative' ? '#e6f4ea' : '#f0f0f0'
              }}>
                {doc.partition === 'personal' ? '个人' : 
                 doc.partition === 'shared' ? '只读' : '协作'}
              </span>
            </div>
            <div className="card-content" style={{ 
              maxHeight: '100px', 
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {preview(doc.content)}
            </div>
          </div>
        ))
      )}

      {showCreateModal && effectiveProjectId && (
        <CreateDocumentModal
          projectId={effectiveProjectId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={loadDocuments}
        />
      )}
    </div>
  );
}

export default DocumentsView;
