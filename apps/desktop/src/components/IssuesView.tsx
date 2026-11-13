import { useEffect, useState } from 'react';
import { WSEventType } from '@gteam/shared';
import { createApiClient, useStore } from '../store';
import { getApiErrorMessage } from '../lib/apiError';
import { issuePriorityLabel, issueStatusLabel } from '../lib/labels';
import { formatDate } from '../lib/normalize';
import { reloadProjects } from '../lib/teamData';
import CreateIssueModal from './CreateIssueModal';
import ErrorBanner from './ErrorBanner';
import IssueDetail from './IssueDetail';

function IssuesView() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { getActiveConnection, teamData, activeConnectionId, setIssues } = useStore();
  const activeConnection = getActiveConnection();
  const bucket = activeConnectionId ? teamData[activeConnectionId] : undefined;
  const projects = bucket?.projects || [];
  const issues = bucket?.issues || [];
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState('');
  const selected = issues.find((item) => item.id === selectedId) || null;
  const issueEvent = (bucket?.notifications || []).find((event) =>
    event.type === WSEventType.IssueCreated ||
    event.type === WSEventType.IssueUpdated ||
    event.type === WSEventType.IssueDeleted ||
    event.type === WSEventType.IssueReplied
  );

  useEffect(() => {
    if (projects.length > 0 && !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    setSelectedId(null);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!activeConnection?.token || !selectedProjectId) return;
    let cancelled = false;
    setLoading(true);
    setListError('');
    (async () => {
      try {
        const api = createApiClient(activeConnection);
        const response = await api.get(`/api/issues?projectId=${selectedProjectId}`);
        if (response.data?.success === false) {
          throw new Error(response.data.error || '加载问题失败');
        }
        if (cancelled) return;
        setIssues(activeConnection.id, response.data.data || []);
        setLoadedProjectId(selectedProjectId);
      } catch (error) {
        if (!cancelled) setListError(getApiErrorMessage(error, '加载问题失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, activeConnection?.token, selectedProjectId, refreshKey, issueEvent?.type, issueEvent?.timestamp]);

  if (!activeConnection) return <div className="loading">加载中...</div>;

  if (!bucket?.projectsLoaded && !bucket?.projectsError) {
    return <div className="loading">加载项目...</div>;
  }

  if (bucket?.projectsError && projects.length === 0) {
    return (
      <div>
        <div className="header"><h1>问题</h1></div>
        <ErrorBanner message={bucket.projectsError} onRetry={() => reloadProjects(activeConnection)} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div>
        <div className="header"><h1>问题</h1></div>
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
        <h1>问题</h1>
        <button type="button" className="btn" onClick={() => setShowCreateModal(true)}>新建问题</button>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <select
          value={selectedProjectId}
          onChange={(event) => setSelectedProjectId(event.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </div>

      <ErrorBanner message={listError} onRetry={() => setRefreshKey((value) => value + 1)} />
      {loading && !ready && <div className="loading">加载中...</div>}

      {selected && ready && (
        <IssueDetail
          issue={selected}
          connection={activeConnection}
          onClose={() => setSelectedId(null)}
          onChanged={() => setRefreshKey((value) => value + 1)}
        />
      )}

      {ready && issues.length === 0 && (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>暂无问题</p>
        </div>
      )}

      {ready && issues.map((issue) => (
        <div
          key={issue.id}
          className={`card${issue.id === selectedId ? ' selected' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => setSelectedId(issue.id)}
        >
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
                {formatDate(issue.createdAt)}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: '12px' }}>
              <span style={{
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                backgroundColor: issue.priority === 'urgent' ? '#fee' : issue.priority === 'high' ? '#fef3e0' : '#f0f0f0'
              }}>
                {issuePriorityLabel[issue.priority] || issue.priority}
              </span>
              <span style={{
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                backgroundColor: issue.status === 'open' ? '#e3f2fd' : '#f0f0f0'
              }}>
                {issueStatusLabel[issue.status] || issue.status}
              </span>
            </div>
          </div>
        </div>
      ))}

      {showCreateModal && selectedProjectId && (
        <CreateIssueModal
          projectId={selectedProjectId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => setRefreshKey((value) => value + 1)}
        />
      )}
    </div>
  );
}

export default IssuesView;
