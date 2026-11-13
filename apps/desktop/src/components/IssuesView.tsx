import { useEffect, useState } from 'react';
import { useStore, createApiClient } from '../store';
import CreateIssueModal from './CreateIssueModal';
import { apiErrorMessage } from '../lib/apiError';
import { formatDateTime, normalizeIssue } from '../lib/normalize';

function IssuesView() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');
  const { getActiveConnection, teamData, activeConnectionId, resourceErrors, setIssues } = useStore();
  const activeConnection = getActiveConnection();
  const projects = activeConnectionId ? teamData[activeConnectionId]?.projects || [] : [];
  const issues = activeConnectionId ? teamData[activeConnectionId]?.issues || [] : [];
  const projectsError = activeConnectionId ? resourceErrors[activeConnectionId]?.projects : undefined;
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const effectiveProjectId = projects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : (projects[0]?.id ?? '');

  useEffect(() => {
    if (activeConnection && effectiveProjectId) {
      loadIssues();
    }
  }, [activeConnectionId, effectiveProjectId]);

  const loadIssues = async () => {
    if (!activeConnection || !effectiveProjectId) return;
    
    try {
      const api = createApiClient(activeConnection);
      const response = await api.get(`/api/issues?projectId=${effectiveProjectId}`);
      if (!response.data?.success || !Array.isArray(response.data.data)) {
        setError(response.data?.error || '加载问题失败');
        return;
      }
      setIssues(activeConnection.id, response.data.data.map(normalizeIssue));
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, '加载问题失败'));
    }
  };

  if (!activeConnection) {
    return <div className="loading">加载中...</div>;
  }

  if (projects.length === 0) {
    return (
      <div>
        <div className="header">
          <h1>问题</h1>
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

  return (
    <div>
      <div className="header">
        <h1>问题</h1>
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
          新建问题
        </button>
      </div>

      {error && (
        <div className="error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{error}</span>
          <button type="button" className="btn btn-secondary" onClick={loadIssues}>重试</button>
        </div>
      )}
      
      <div style={{ marginBottom: '16px' }}>
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
      </div>
      
      {issues.length === 0 && !error ? (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>暂无问题</p>
        </div>
      ) : (
        issues.map((issue) => (
          <div key={issue.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  {issue.createdByAI && (
                    <span style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      backgroundColor: '#e3f2fd',
                      color: '#1976d2'
                    }}>
                      🤖 AI
                    </span>
                  )}
                  <div className="card-title" style={{ marginBottom: 0 }}>{issue.title}</div>
                </div>
                <div className="card-content">{issue.description}</div>
                <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {formatDateTime(issue.createdAt) || '未知时间'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: '12px' }}>
                <span style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  backgroundColor: issue.priority === 'urgent' ? '#fee' : 
                                   issue.priority === 'high' ? '#fef3e0' : '#f0f0f0'
                }}>
                  {issue.priority === 'urgent' ? '紧急' :
                   issue.priority === 'high' ? '高' :
                   issue.priority === 'medium' ? '中' : '低'}
                </span>
                <span style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  backgroundColor: issue.status === 'open' ? '#e3f2fd' : '#f0f0f0'
                }}>
                  {issue.status === 'open' ? '待处理' :
                   issue.status === 'in_progress' ? '处理中' :
                   issue.status === 'resolved' ? '已解决' : '已关闭'}
                </span>
              </div>
            </div>
          </div>
        ))
      )}

      {showCreateModal && effectiveProjectId && (
        <CreateIssueModal
          projectId={effectiveProjectId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={loadIssues}
        />
      )}
    </div>
  );
}

export default IssuesView;
