import { useStore } from '../store';

function ProjectsView() {
  const { getActiveConnection, teamData, activeConnectionId } = useStore();
  const activeConnection = getActiveConnection();
  const projects = activeConnectionId ? teamData[activeConnectionId]?.projects || [] : [];

  if (!activeConnection) {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div>
      <div className="header">
        <h1>项目</h1>
        <button className="btn">新建项目</button>
      </div>
      
      {projects.length === 0 ? (
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
    </div>
  );
}

export default ProjectsView;
