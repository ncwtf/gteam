import { useEffect, useState } from 'react';
import { useStore, createApiClient } from '../store';
import CreateRequirementModal from './CreateRequirementModal';

function RequirementsView() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { getActiveConnection, teamData, activeConnectionId, setRequirements } = useStore();
  const activeConnection = getActiveConnection();
  const projects = activeConnectionId ? teamData[activeConnectionId]?.projects || [] : [];
  const requirements = activeConnectionId ? teamData[activeConnectionId]?.requirements || [] : [];
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects]);

  useEffect(() => {
    if (activeConnection && selectedProjectId) {
      loadRequirements();
    }
  }, [selectedProjectId]);

  const loadRequirements = async () => {
    if (!activeConnection || !selectedProjectId) return;
    
    try {
      const api = createApiClient(activeConnection);
      const response = await api.get(`/api/requirements?projectId=${selectedProjectId}`);
      setRequirements(activeConnection.id, response.data.data);
    } catch (error) {
      console.error('加载需求失败:', error);
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
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>请先创建一个项目</p>
        </div>
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

  const currentProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div>
      <div className="header">
        <h1>需求</h1>
        <button className="btn" onClick={() => setShowCreateModal(true)}>新建需求</button>
      </div>
      
      <div style={{ marginBottom: '16px' }}>
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
      </div>
      
      {requirements.length === 0 ? (
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
                  }}>{req.gitBranch}</code>
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

      {showCreateModal && selectedProjectId && (
        <CreateRequirementModal
          projectId={selectedProjectId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={loadRequirements}
        />
      )}
    </div>
  );
}

export default RequirementsView;
