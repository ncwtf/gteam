import { useEffect, useState } from 'react';
import { useStore, createApiClient } from '../store';
import { apiErrorMessage } from '../lib/apiError';
import { DocumentPartition } from '@gteam/shared';
import CreateDocumentModal from './CreateDocumentModal';

function DocumentsView() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loadError, setLoadError] = useState('');
  const { getActiveConnection, teamData, activeConnectionId, setDocuments } = useStore();
  const activeConnection = getActiveConnection();
  const documents = activeConnectionId ? teamData[activeConnectionId]?.documents || [] : [];
  const projects = activeConnectionId ? teamData[activeConnectionId]?.projects || [] : [];
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [partition, setPartition] = useState<DocumentPartition | 'all'>('all');

  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects]);

  useEffect(() => {
    if (activeConnection && selectedProjectId) {
      loadDocuments();
    }
  }, [selectedProjectId, partition]);

  const loadDocuments = async () => {
    if (!activeConnection || !selectedProjectId) return;
    
    try {
      const api = createApiClient(activeConnection);
      const params = new URLSearchParams({ projectId: selectedProjectId });
      if (partition !== 'all') {
        params.append('partition', partition);
      }
      const response = await api.get(`/api/documents?${params}`);
      setDocuments(activeConnection.id, response.data.data);
      setLoadError('');
    } catch (error) {
      setLoadError(apiErrorMessage(error, '加载文档失败'));
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
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>请先创建一个项目</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="header">
        <h1>文档</h1>
        <button className="btn" onClick={() => setShowCreateModal(true)}>新建文档</button>
      </div>

      {loadError && <div className="error">{loadError}</div>}
      
      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px' }}>
        <select
          value={selectedProjectId}
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
          onChange={(e) => setPartition(e.target.value as any)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
        >
          <option value="all">全部分区</option>
          <option value={DocumentPartition.Personal}>个人</option>
          <option value={DocumentPartition.Shared}>共享（只读）</option>
          <option value={DocumentPartition.Collaborative}>协作</option>
        </select>
      </div>
      
      {documents.length === 0 ? (
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
                  分区: {doc.partition} | 更新: {new Date(doc.updatedAt).toLocaleString('zh-CN')}
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
              {doc.content.substring(0, 200)}...
            </div>
          </div>
        ))
      )}

      {showCreateModal && selectedProjectId && (
        <CreateDocumentModal
          projectId={selectedProjectId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={loadDocuments}
        />
      )}
    </div>
  );
}

export default DocumentsView;
