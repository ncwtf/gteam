import { useStore } from '../store';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: any) => void;
}

function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const { getActiveConnection } = useStore();
  const activeConnection = getActiveConnection();

  if (!activeConnection) {
    return null;
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">{activeConnection.teamName}</div>
      
      <nav>
        <a
          className={`nav-item ${currentView === 'projects' ? 'active' : ''}`}
          onClick={() => onViewChange('projects')}
        >
          📁 项目
        </a>
        <a
          className={`nav-item ${currentView === 'documents' ? 'active' : ''}`}
          onClick={() => onViewChange('documents')}
        >
          📄 文档
        </a>
        <a
          className={`nav-item ${currentView === 'requirements' ? 'active' : ''}`}
          onClick={() => onViewChange('requirements')}
        >
          ✅ 需求
        </a>
        <a
          className={`nav-item ${currentView === 'issues' ? 'active' : ''}`}
          onClick={() => onViewChange('issues')}
        >
          🔔 问题
        </a>
        <a
          className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
          onClick={() => onViewChange('settings')}
        >
          ⚙️ 设置
        </a>
      </nav>
      
      <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          {activeConnection.userName}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {activeConnection.serverUrl}
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
