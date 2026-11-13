import { useState } from 'react';
import { useStore } from '../store';
import { reloadProjects } from '../lib/teamData';
import CreateProjectModal from './CreateProjectModal';
import ErrorBanner from './ErrorBanner';
import ProjectDetail from './ProjectDetail';

function ProjectsView() {
  const { getActiveConnection, teamData, activeConnectionId } = useStore();
  const activeConnection = getActiveConnection();
  const bucket = activeConnectionId ? teamData[activeConnectionId] : undefined;
  const projects = bucket?.projects || [];
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = projects.find((project) => project.id === selectedId) || null;

  if (!activeConnection) {
    return <div className="loading">加载中...</div>;
  }

  if (!activeConnection.token && !bucket?.projectsError) {
    return <div className="loading">正在恢复登录状态...</div>;
  }

  return (
    <div>
      <div className="header">
        <h1>项目</h1>
        <button type="button" className="btn" onClick={() => setShowCreate(true)}>新建项目</button>
      </div>

      {activeConnection.isAdmin === false && (
        <p className="card-content" style={{ marginBottom: 12 }}>
          当前账号不是团队管理员。创建或修改项目如果被拒绝，原因会直接显示出来。
        </p>
      )}

      <ErrorBanner message={bucket?.projectsError} onRetry={() => reloadProjects(activeConnection)} />

      {!bucket?.projectsLoaded && !bucket?.projectsError && (
        <div className="loading">加载中...</div>
      )}

      {selected && (
        <ProjectDetail
          project={selected}
          connection={activeConnection}
          onClose={() => setSelectedId(null)}
          onChanged={() => reloadProjects(activeConnection)}
        />
      )}

      {bucket?.projectsLoaded && !bucket.projectsError && projects.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)' }}>暂无项目，点击上方按钮创建第一个项目</p>
        </div>
      ) : (
        projects.map((project) => (
          <div
            key={project.id}
            className={`card${project.id === selectedId ? ' selected' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setSelectedId(project.id)}
          >
            <div className="card-title">{project.name}</div>
            <div className="card-content">{project.description || '暂无描述'}</div>
            {project.gitRepoUrl && (
              <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                📦 {project.gitRepoUrl}
              </div>
            )}
          </div>
        ))
      )}

      {showCreate && (
        <CreateProjectModal
          connection={activeConnection}
          onClose={() => setShowCreate(false)}
          onCreated={(project) => {
            const current = useStore.getState().teamData[activeConnection.id]?.projects || [];
            useStore.getState().setProjects(
              activeConnection.id,
              [project, ...current.filter((item) => item.id !== project.id)]
            );
            reloadProjects(activeConnection);
          }}
        />
      )}
    </div>
  );
}

export default ProjectsView;
