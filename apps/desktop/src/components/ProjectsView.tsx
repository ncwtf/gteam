import { useState } from 'react';
import { Project } from '@gteam/shared';
import { useStore } from '../store';
import CreateProjectModal from './CreateProjectModal';

function ProjectsView() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const {
    getActiveConnection,
    teamData,
    activeConnectionId,
    resourceErrors,
    setProjects,
    loadProjects
  } = useStore();
  const activeConnection = getActiveConnection();
  const projects = activeConnectionId ? teamData[activeConnectionId]?.projects || [] : [];
  const projectsError = activeConnectionId ? resourceErrors[activeConnectionId]?.projects : undefined;

  if (!activeConnection || !activeConnectionId) {
    return <div className="loading">加载中...</div>;
  }

  const handleCreated = (project: Project) => {
    const existing = teamData[activeConnectionId]?.projects || [];
    setProjects(activeConnectionId, [project, ...existing.filter((item) => item.id !== project.id)]);
    loadProjects(activeConnectionId);
  };

  return (
    <div>
      <div className="header">
        <h1>项目</h1>
        <button type="button" className="btn" onClick={() => setShowCreateModal(true)}>新建项目</button>
      </div>

      {projectsError && (
        <div className="error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{projectsError}</span>
          <button type="button" className="btn btn-secondary" onClick={() => loadProjects(activeConnectionId)}>
            重试
          </button>
        </div>
      )}

      {projects.length === 0 && !projectsError ? (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>暂无项目，点击上方按钮创建第一个项目</p>
        </div>
      ) : (
        projects.map((project) => (
          <div
            key={project.id}
            className="card"
            style={{ cursor: 'pointer' }}
          >
            <div className="card-title">{project.name}</div>
            <div className="card-content">
              {project.description || '暂无描述'}
            </div>
            {project.gitRepoUrl && (
              <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                📦 {project.gitRepoUrl}
              </div>
            )}
          </div>
        ))
      )}

      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreated}
        />
      )}
    </div>
  );
}

export default ProjectsView;
