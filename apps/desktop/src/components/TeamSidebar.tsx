import { useStore } from '../store';

interface TeamSidebarProps {
  onAddTeam: () => void;
}

function TeamSidebar({ onAddTeam }: TeamSidebarProps) {
  const { connections, activeConnectionId, setActiveConnection } = useStore();

  const getTeamInitials = (teamName: string) => {
    return teamName
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <aside style={{
      width: '72px',
      backgroundColor: '#1a1a1a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 0',
      gap: '8px'
    }}>
      {connections.map((connection) => {
        const isActive = connection.id === activeConnectionId;
        const hasNotifications = useStore.getState().teamData[connection.id]?.notifications.length > 0;
        
        return (
          <div
            key={connection.id}
            onClick={() => setActiveConnection(connection.id)}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: isActive ? '12px' : '24px',
              backgroundColor: isActive ? '#5865F2' : '#313338',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 600,
              fontSize: '16px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              position: 'relative',
              border: isActive ? '2px solid white' : 'none'
            }}
            title={connection.teamName}
          >
            {getTeamInitials(connection.teamName)}
            {hasNotifications && (
              <span style={{
                position: 'absolute',
                top: '-2px',
                right: '-2px',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#f23f43',
                border: '2px solid #1a1a1a'
              }} />
            )}
          </div>
        );
      })}
      
      <div
        onClick={onAddTeam}
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '24px',
          backgroundColor: '#313338',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#3ba55d',
          fontSize: '24px',
          cursor: 'pointer',
          transition: 'all 0.2s',
          marginTop: '8px',
          border: '2px dashed #3ba55d'
        }}
        title="添加团队"
      >
        +
      </div>
    </aside>
  );
}

export default TeamSidebar;
