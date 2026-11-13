import { useEffect, useState } from 'react';
import { useStore, createApiClient } from '../store';
import { apiErrorMessage } from '../lib/apiError';
import CreateProjectModal from './CreateProjectModal';

function ProjectsView() {
  const { getActiveConnection, teamData, activeConnectionId, setProjects } = useStore();
  const activeConnection = getActiveConnection();
  const projects = activeConnectionId ? teamData[activeConnectionId]?.projects || [] : [];
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadProjects = async () => {
    if (!activeConnection) return;
    try {
      const api = createApiClient(activeConnection);
      const response = await api.get('/api/projects');
      setProjects(activeConnection.id, response.data.data || []);
      setLoadError('');
    } catch (err) {
      setLoadError(apiErrorMessage(err, '加载项目失败'));
    }
  };

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  if (!activeConnection) {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div>
      <div className="header">
        <h1>项目</h1>
        <button className="btn" onClick={() => setShowCreateModal(true)}>新建项目</button>
      </div>

      {loadError && <div className="error">{loadError}</div>}

      {projects.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>暂无项目，点击上方按钮创建第一个项目</p>
        </div>
      ) : (
        projects.map((project: any) => {
          const repo = project.gitRepoUrl || project.git_repo_url;
          return (
            <div key={project.id} className="card">
              <div className="card-title">{project.name}</div>
              <div className="card-content">{project.description || '暂无描述'}</div>
              {repo && (
                <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                  📦 {repo}
                </div>
              )}
            </div>
          );
        })
      )}

      {showCreateModal && (
        <CreateProjectModal onClose={() => setShowCreateModal(false)} onSuccess={loadProjects} />
      )}
    </div>
  );
}

export default ProjectsView;
