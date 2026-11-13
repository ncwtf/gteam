import { useEffect, useState } from 'react';
import { useStore } from './store';
import Login from './components/Login';
import TeamSidebar from './components/TeamSidebar';
import Sidebar from './components/Sidebar';
import ProjectsView from './components/ProjectsView';
import DocumentsView from './components/DocumentsView';
import RequirementsView from './components/RequirementsView';
import IssuesView from './components/IssuesView';
import SettingsView from './components/SettingsView';
import FloatingWindow from './components/FloatingWindow';
import AddTeamModal from './components/AddTeamModal';
import UpdateBanner from './components/UpdateBanner';

type View = 'projects' | 'documents' | 'requirements' | 'issues' | 'settings';

function App() {
  const { connections, activeConnectionId, getActiveConnection, connectWebSocket, disconnectAllWebSockets } = useStore();
  const [currentView, setCurrentView] = useState<View>('projects');
  const [showAddTeam, setShowAddTeam] = useState(false);

  const activeConnection = getActiveConnection();

  useEffect(() => {
    // 连接所有团队的 WebSocket
    connections.forEach((conn) => {
      connectWebSocket(conn.id);
    });

    return () => {
      disconnectAllWebSockets();
    };
  }, [connections.length]);

  useEffect(() => {
    if (activeConnectionId) {
      useStore.getState().loadProjects(activeConnectionId);
    }
  }, [activeConnectionId]);

  // 如果没有任何团队连接，显示添加团队界面
  if (connections.length === 0) {
    return (
      <>
        <UpdateBanner />
        <Login onAddTeam={() => setShowAddTeam(true)} />
        {showAddTeam && <AddTeamModal onClose={() => setShowAddTeam(false)} />}
      </>
    );
  }

  // 如果没有激活的团队，选择第一个
  if (!activeConnection && connections.length > 0) {
    useStore.getState().setActiveConnection(connections[0].id);
    return null;
  }

  return (
    <div className="container">
      <UpdateBanner />
      <TeamSidebar onAddTeam={() => setShowAddTeam(true)} />
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="main-content">
        {currentView === 'projects' && <ProjectsView />}
        {currentView === 'documents' && <DocumentsView />}
        {currentView === 'requirements' && <RequirementsView />}
        {currentView === 'issues' && <IssuesView />}
        {currentView === 'settings' && <SettingsView />}
      </main>
      <FloatingWindow />
      {showAddTeam && <AddTeamModal onClose={() => setShowAddTeam(false)} />}
    </div>
  );
}

export default App;
