import { useEffect, useState } from 'react';
import { WSEventType } from '@gteam/shared';
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
import { restoreConnection } from './lib/session';
import { legacyTokenSnapshot, useStore } from './store';
import ReconnectPrompt from './components/ReconnectPrompt';

type View = 'projects' | 'documents' | 'requirements' | 'issues' | 'settings';

function App() {
  const {
    connections,
    activeConnectionId,
    teamData,
    sessionNotice,
    setSessionNotice,
    getActiveConnection,
    connectWebSocket,
    disconnectAllWebSockets,
    tokenRestore
  } = useStore();
  const [currentView, setCurrentView] = useState<View>('projects');
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());

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
    if (useStore.persist.hasHydrated()) setHydrated(true);
    return useStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const pending = useStore.getState().connections.filter((connection) => (
      useStore.getState().tokenRestore[connection.id] !== 'ready'
    ));
    pending.forEach((connection) => {
      useStore.getState().ensureTeamData(connection.id);
      restoreConnection(connection, legacyTokenSnapshot)
        .then((restored) => {
          if (cancelled) return;
          const current = useStore.getState().connections.find((item) => item.id === connection.id);
          if (!current) return;
          if (restored.notice) useStore.getState().setSessionNotice(restored.notice);
          if (restored.status === 'ready') {
            useStore.getState().updateConnection(connection.id, {
              token: restored.token,
              ...(restored.email ? { email: restored.email } : {})
            });
            useStore.getState().setTokenRestore(connection.id, 'ready');
            return;
          }
          if (!current.token) useStore.getState().setTokenRestore(connection.id, 'missing');
        })
        .catch(() => {
          if (cancelled) return;
          const current = useStore.getState().connections.find((item) => item.id === connection.id);
          if (current && !current.token) {
            useStore.getState().setSessionNotice('无法读取系统密钥链，请重新登录');
            useStore.getState().setTokenRestore(connection.id, 'missing');
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [connectionKey, hydrated]);

  useEffect(() => {
    if (!activeConnection?.token) return;
    reloadProjects(activeConnection);
  }, [activeConnection?.id, activeConnection?.token, projectEvent?.type, projectEvent?.timestamp]);

  if (!hydrated) {
    return <div className="loading">正在恢复登录状态...</div>;
  }

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
        {activeConnection && !activeConnection.token && tokenRestore[activeConnection.id] !== 'missing' && (
          <div className="loading">正在恢复登录状态...</div>
        )}
        {activeConnection && !activeConnection.token && tokenRestore[activeConnection.id] === 'missing' && (
          <ReconnectPrompt connection={activeConnection} />
        )}
        {activeConnection?.token && currentView === 'projects' && <ProjectsView />}
        {activeConnection?.token && currentView === 'documents' && <DocumentsView />}
        {activeConnection?.token && currentView === 'requirements' && <RequirementsView />}
        {activeConnection?.token && currentView === 'issues' && <IssuesView />}
        {activeConnection?.token && currentView === 'settings' && <SettingsView />}
      </main>
      <FloatingWindow />
      {showAddTeam && <AddTeamModal onClose={() => setShowAddTeam(false)} />}
    </div>
  );
}

export default App;
