import { useEffect, useState } from 'react';
import { DocumentPartition, WSEventType } from '@gteam/shared';
import { createApiClient, useStore } from '../store';
import { getApiErrorMessage } from '../lib/apiError';
import { partitionLabel } from '../lib/labels';
import { formatDate, previewText } from '../lib/normalize';
import { reloadProjects } from '../lib/teamData';
import CreateDocumentModal from './CreateDocumentModal';
import DocumentDetail from './DocumentDetail';
import ErrorBanner from './ErrorBanner';

function DocumentsView() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { getActiveConnection, teamData, activeConnectionId, setDocuments } = useStore();
  const activeConnection = getActiveConnection();
  const bucket = activeConnectionId ? teamData[activeConnectionId] : undefined;
  const documents = bucket?.documents || [];
  const projects = bucket?.projects || [];
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [partition, setPartition] = useState<DocumentPartition | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState('');
  const selected = documents.find((doc) => doc.id === selectedId) || null;
  const docEvent = (bucket?.notifications || []).find((event) =>
    event.type === WSEventType.DocumentCreated ||
    event.type === WSEventType.DocumentUpdated ||
    event.type === WSEventType.DocumentDeleted
  );

  useEffect(() => {
    if (projects.length > 0 && !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    setSelectedId(null);
  }, [selectedProjectId, partition]);

  useEffect(() => {
    if (!activeConnection?.token || !selectedProjectId) return;
    let cancelled = false;
    setLoading(true);
    setListError('');
    (async () => {
      try {
        const api = createApiClient(activeConnection);
        const params = new URLSearchParams({ projectId: selectedProjectId });
        if (partition !== 'all') params.append('partition', partition);
        const response = await api.get(`/api/documents?${params}`);
        if (response.data?.success === false) {
          throw new Error(response.data.error || '加载文档失败');
        }
        if (cancelled) return;
        setDocuments(activeConnection.id, response.data.data || []);
        setLoadedProjectId(selectedProjectId);
      } catch (error) {
        if (!cancelled) setListError(getApiErrorMessage(error, '加载文档失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, activeConnection?.token, selectedProjectId, partition, refreshKey, docEvent?.type, docEvent?.timestamp]);

  if (!activeConnection) return <div className="loading">加载中...</div>;

  if (!bucket?.projectsLoaded && !bucket?.projectsError) {
    return <div className="loading">加载项目...</div>;
  }

  if (bucket?.projectsError && projects.length === 0) {
    return (
      <div>
        <div className="header"><h1>文档</h1></div>
        <ErrorBanner message={bucket.projectsError} onRetry={() => reloadProjects(activeConnection)} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div>
        <div className="header"><h1>文档</h1></div>
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>请先创建一个项目</p>
        </div>
      </div>
    );
  }

  const ready = !loading && !listError && loadedProjectId === selectedProjectId;

  return (
    <div>
      <div className="header">
        <h1>文档</h1>
        <button type="button" className="btn" onClick={() => setShowCreateModal(true)}>新建文档</button>
      </div>

      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px' }}>
        <select
          value={selectedProjectId}
          onChange={(event) => setSelectedProjectId(event.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <select
          value={partition}
          onChange={(event) => setPartition(event.target.value as DocumentPartition | 'all')}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
        >
          <option value="all">全部分区</option>
          <option value={DocumentPartition.Personal}>个人</option>
          <option value={DocumentPartition.Shared}>共享（只读）</option>
          <option value={DocumentPartition.Collaborative}>协作</option>
        </select>
      </div>

      <ErrorBanner message={listError} onRetry={() => setRefreshKey((value) => value + 1)} />
      {loading && !ready && <div className="loading">加载中...</div>}

      {selected && ready && (
        <DocumentDetail
          document={selected}
          connection={activeConnection}
          onClose={() => setSelectedId(null)}
          onChanged={() => setRefreshKey((value) => value + 1)}
        />
      )}

      {ready && documents.length === 0 && (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>暂无文档</p>
        </div>
      )}

      {ready && documents.map((doc) => (
        <div
          key={doc.id}
          className={`card${doc.id === selectedId ? ' selected' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => setSelectedId(doc.id)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div>
              <div className="card-title">{doc.title}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                分区: {partitionLabel[doc.partition] || doc.partition} | 更新: {formatDate(doc.updatedAt)}
              </div>
            </div>
            <span style={{
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              backgroundColor: doc.partition === 'collaborative' ? '#e6f4ea' : '#f0f0f0'
            }}>
              {partitionLabel[doc.partition] || doc.partition}
            </span>
          </div>
          <div className="card-content">{previewText(doc.content)}</div>
        </div>
      ))}

      {showCreateModal && selectedProjectId && (
        <CreateDocumentModal
          projectId={selectedProjectId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => setRefreshKey((value) => value + 1)}
        />
      )}
    </div>
  );
}

export default DocumentsView;
