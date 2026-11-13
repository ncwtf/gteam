import { useEffect, useState } from 'react';
import { WSEventType } from '@gteam/shared';
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
import ErrorBanner from './components/ErrorBanner';
import { reloadProjects } from './lib/teamData';
import { isTauri, restoreToken } from './lib/session';
import { useGitProgressSync } from './lib/gitSync';

type View = 'projects' | 'documents' | 'requirements' | 'issues' | 'settings';

function App() {
  useGitProgressSync();
  const {
    connections,
    activeConnectionId,
    teamData,
    sessionNotice,
    setSessionNotice,
    getActiveConnection,
    connectWebSocket,
    disconnectAllWebSockets
  } = useStore();
  const [currentView, setCurrentView] = useState<View>('projects');
  const [showAddTeam, setShowAddTeam] = useState(false);

  const activeConnection = getActiveConnection();
  const connectionKey = connections.map((connection) => `${connection.id}:${connection.token ? '1' : '0'}`).join('|');
  const projectEvent = activeConnectionId
    ? teamData[activeConnectionId]?.notifications?.find((event) =>
      event.type === WSEventType.ProjectCreated ||
      event.type === WSEventType.ProjectUpdated ||
      event.type === WSEventType.ProjectDeleted
    )
    : undefined;

  useEffect(() => {
    connections.forEach((conn) => {
      useStore.getState().ensureTeamData(conn.id);
      connectWebSocket(conn.id);
    });

    return () => {
      disconnectAllWebSockets();
    };
  }, [connectionKey]);

  useEffect(() => {
    const pending = useStore.getState().connections.filter((connection) => !connection.token);
    pending.forEach((connection) => {
      useStore.getState().ensureTeamData(connection.id);
      if (!isTauri()) {
        useStore.getState().setProjectsError(connection.id, '登录状态已失效，请重新连接团队');
        return;
      }
      restoreToken(connection.serverUrl)
        .then((token) => {
          const current = useStore.getState().connections.find((item) => item.id === connection.id);
          if (!current || current.token) return;
          if (token) {
            useStore.getState().updateConnection(connection.id, { token });
            return;
          }
          useStore.getState().setProjectsError(connection.id, '登录状态已失效，请重新连接团队');
        })
        .catch(() => {
          const current = useStore.getState().connections.find((item) => item.id === connection.id);
          if (current && !current.token) {
            useStore.getState().setProjectsError(connection.id, '登录状态已失效，请重新连接团队');
          }
        });
    });
  }, [connectionKey]);

  useEffect(() => {
    if (!activeConnection?.token) return;
    reloadProjects(activeConnection);
  }, [activeConnection?.id, activeConnection?.token, projectEvent?.type, projectEvent?.timestamp]);

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
        <ErrorBanner message={sessionNotice} onRetry={() => setSessionNotice(null)} retryLabel="知道了" />
        <ErrorBanner message={activeConnectionId ? teamData[activeConnectionId]?.realtimeError : null} />
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
