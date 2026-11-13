import { useState } from 'react';
import { useStore } from '../store';
import { deletionFailure } from '../lib/keychainErrors';
import { forgetToken } from '../lib/session';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: any) => void;
}

function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const { getActiveConnection, removeConnection, setSessionNotice } = useStore();
  const activeConnection = getActiveConnection();
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    if (!activeConnection || disconnecting) return;
    const connectionId = activeConnection.id;
    const serverUrl = activeConnection.serverUrl;
    setDisconnecting(true);
    try {
      const warning = await forgetToken(serverUrl);
      if (warning) setSessionNotice(warning);
    } catch (error) {
      const warning = deletionFailure(error);
      if (warning) setSessionNotice(warning);
    } finally {
      removeConnection(connectionId);
      setDisconnecting(false);
    }
  };

  if (!activeConnection) {
    return null;
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <img 
          src="/icon.svg" 
          alt="gteam" 
          style={{ width: '24px', height: '24px', flexShrink: 0 }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeConnection.teamName}
        </span>
      </div>
      
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
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 12, width: '100%' }}
          onClick={handleDisconnect}
          disabled={disconnecting}
        >
          {disconnecting ? '正在断开...' : '断开此团队'}
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
