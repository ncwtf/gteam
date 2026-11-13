import { useEffect, useState } from 'react';
import { WSEventType } from '@gteam/shared';
import { createApiClient, useStore } from '../store';
import { getApiErrorMessage } from '../lib/apiError';
import { requirementStatusColor, requirementStatusLabel } from '../lib/labels';
import { reloadProjects } from '../lib/teamData';
import CreateRequirementModal from './CreateRequirementModal';
import ErrorBanner from './ErrorBanner';
import RequirementDetail from './RequirementDetail';

function RequirementsView() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { getActiveConnection, teamData, activeConnectionId, setRequirements } = useStore();
  const activeConnection = getActiveConnection();
  const bucket = activeConnectionId ? teamData[activeConnectionId] : undefined;
  const projects = bucket?.projects || [];
  const requirements = bucket?.requirements || [];
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState('');
  const selected = requirements.find((item) => item.id === selectedId) || null;
  const requirementEvent = (bucket?.notifications || []).find((event) =>
    event.type === WSEventType.RequirementCreated ||
    event.type === WSEventType.RequirementUpdated ||
    event.type === WSEventType.RequirementStatusChanged ||
    event.type === WSEventType.RequirementDeleted
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
        const response = await api.get(`/api/requirements?projectId=${selectedProjectId}`);
        if (response.data?.success === false) {
          throw new Error(response.data.error || '加载需求失败');
        }
        if (cancelled) return;
        setRequirements(activeConnection.id, response.data.data || []);
        setLoadedProjectId(selectedProjectId);
      } catch (error) {
        if (!cancelled) setListError(getApiErrorMessage(error, '加载需求失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, activeConnection?.token, selectedProjectId, refreshKey, requirementEvent?.type, requirementEvent?.timestamp]);

  if (!activeConnection) return <div className="loading">加载中...</div>;

  if (!bucket?.projectsLoaded && !bucket?.projectsError) {
    return <div className="loading">加载项目...</div>;
  }

  if (bucket?.projectsError && projects.length === 0) {
    return (
      <div>
        <div className="header"><h1>需求</h1></div>
        <ErrorBanner message={bucket.projectsError} onRetry={() => reloadProjects(activeConnection)} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div>
        <div className="header"><h1>需求</h1></div>
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
        <h1>需求</h1>
        <button type="button" className="btn" onClick={() => setShowCreateModal(true)}>新建需求</button>
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
        <RequirementDetail
          requirement={selected}
          connection={activeConnection}
          onClose={() => setSelectedId(null)}
          onChanged={() => setRefreshKey((value) => value + 1)}
        />
      )}

      {ready && requirements.length === 0 && (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>暂无需求</p>
        </div>
      )}

      {ready && requirements.map((req) => (
        <div
          key={req.id}
          className={`card${req.id === selectedId ? ' selected' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => setSelectedId(req.id)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div style={{ flex: 1 }}>
              <div className="card-title">{req.title}</div>
              <div className="card-content">{req.description}</div>
              <div style={{ marginTop: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                🌿 分支: <code style={{ padding: '2px 6px', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px' }}>{req.gitBranch}</code>
              </div>
            </div>
            <span style={{
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: 500,
              color: 'white',
              backgroundColor: requirementStatusColor[req.status] || '#999'
            }}>
              {requirementStatusLabel[req.status] || req.status}
            </span>
          </div>
        </div>
      ))}

      {showCreateModal && selectedProjectId && (
        <CreateRequirementModal
          projectId={selectedProjectId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => setRefreshKey((value) => value + 1)}
        />
      )}
    </div>
  );
}

export default RequirementsView;
