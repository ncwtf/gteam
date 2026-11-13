import { useEffect, useState } from 'react';
import { useStore, createApiClient } from '../store';
import CreateRequirementModal from './CreateRequirementModal';
import { apiErrorMessage } from '../lib/apiError';
import { normalizeRequirement } from '../lib/normalize';

function RequirementsView() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');
  const { getActiveConnection, teamData, activeConnectionId, resourceErrors, setRequirements } = useStore();
  const activeConnection = getActiveConnection();
  const projects = activeConnectionId ? teamData[activeConnectionId]?.projects || [] : [];
  const requirements = activeConnectionId ? teamData[activeConnectionId]?.requirements || [] : [];
  const projectsError = activeConnectionId ? resourceErrors[activeConnectionId]?.projects : undefined;
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const effectiveProjectId = projects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : (projects[0]?.id ?? '');

  useEffect(() => {
    if (activeConnection && effectiveProjectId) {
      loadRequirements();
    }
  }, [activeConnectionId, effectiveProjectId]);

  const loadRequirements = async () => {
    if (!activeConnection || !effectiveProjectId) return;
    
    try {
      const api = createApiClient(activeConnection);
      const response = await api.get(`/api/requirements?projectId=${effectiveProjectId}`);
      if (!response.data?.success || !Array.isArray(response.data.data)) {
        setError(response.data?.error || '加载需求失败');
        return;
      }
      setRequirements(activeConnection.id, response.data.data.map(normalizeRequirement));
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, '加载需求失败'));
    }
  };

  if (!activeConnection) {
    return <div className="loading">加载中...</div>;
  }

  if (projects.length === 0) {
    return (
      <div>
        <div className="header">
          <h1>需求</h1>
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

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: '待处理',
      in_progress: '进行中',
      completed: '已完成',
      blocked: '阻塞'
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: '#999',
      in_progress: '#0066cc',
      completed: '#00aa00',
      blocked: '#cc0000'
    };
    return colors[status] || '#999';
  };

  return (
    <div>
      <div className="header">
        <h1>需求</h1>
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
          新建需求
        </button>
      </div>

      {error && (
        <div className="error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{error}</span>
          <button type="button" className="btn btn-secondary" onClick={loadRequirements}>重试</button>
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
      
      {requirements.length === 0 && !error ? (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>暂无需求</p>
        </div>
      ) : (
        requirements.map((req) => (
          <div key={req.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <div className="card-title">{req.title}</div>
                <div className="card-content">{req.description}</div>
                <div style={{ marginTop: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                  🌿 分支: <code style={{ 
                    padding: '2px 6px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '4px'
                  }}>{req.gitBranch || '未设置'}</code>
                </div>
              </div>
              <span style={{
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 500,
                color: 'white',
                backgroundColor: getStatusColor(req.status)
              }}>
                {getStatusLabel(req.status)}
              </span>
            </div>
          </div>
        ))
      )}

      {showCreateModal && effectiveProjectId && (
        <CreateRequirementModal
          projectId={effectiveProjectId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={loadRequirements}
        />
      )}
    </div>
  );
}

export default RequirementsView;
