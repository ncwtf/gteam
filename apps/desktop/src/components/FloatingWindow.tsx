import { useState } from 'react';
import { useStore } from '../store';
import { WSEventType } from '@teamctx/shared';

function FloatingWindow() {
  const [isMinimized, setIsMinimized] = useState(false);
  const [filterTeam, setFilterTeam] = useState<string | 'all'>('all');
  
  const { connections, getAllNotifications } = useStore();
  const allNotifications = getAllNotifications();
  
  const filteredNotifications = filterTeam === 'all'
    ? allNotifications
    : allNotifications.filter((n) => n.connectionId === filterTeam);

  if (allNotifications.length === 0) {
    return null;
  }

  const getEventLabel = (type: WSEventType) => {
    const labels: Record<WSEventType, string> = {
      [WSEventType.DocumentCreated]: '📄 新文档',
      [WSEventType.DocumentUpdated]: '📝 文档更新',
      [WSEventType.DocumentDeleted]: '🗑️ 文档删除',
      [WSEventType.RequirementCreated]: '✅ 新需求',
      [WSEventType.RequirementUpdated]: '📋 需求更新',
      [WSEventType.RequirementStatusChanged]: '🔄 需求状态变更',
      [WSEventType.GitProgressUpdated]: '🌿 Git 提交',
      [WSEventType.IssueCreated]: '🔔 新问题',
      [WSEventType.IssueUpdated]: '📌 问题更新',
      [WSEventType.IssueReplied]: '💬 问题回复',
      [WSEventType.UserJoined]: '👋 成员加入',
      [WSEventType.UserLeft]: '👋 成员离开'
    };
    return labels[type] || type;
  };

  const getTeamColor = (connectionId: string) => {
    const colors = ['#5865F2', '#3ba55d', '#faa61a', '#f23f43', '#9b59b6'];
    const index = connections.findIndex((c) => c.id === connectionId);
    return colors[index % colors.length];
  };

  return (
    <div className="floating-window">
      <div className="floating-header">
        <span>🔔 实时通知 ({filteredNotifications.length})</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            {isMinimized ? '▲' : '▼'}
          </button>
          <button
            onClick={() => {
              // 清除所有通知
              connections.forEach((conn) => {
                useStore.getState().clearNotifications(conn.id);
              });
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            ×
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <>
          {connections.length > 1 && (
            <div style={{ 
              padding: '12px 16px', 
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap'
            }}>
              <button
                onClick={() => setFilterTeam('all')}
                style={{
                  padding: '4px 12px',
                  borderRadius: '12px',
                  border: 'none',
                  fontSize: '12px',
                  cursor: 'pointer',
                  backgroundColor: filterTeam === 'all' ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: filterTeam === 'all' ? 'white' : 'var(--text-primary)'
                }}
              >
                全部 ({allNotifications.length})
              </button>
              {connections.map((conn) => {
                const count = allNotifications.filter((n) => n.connectionId === conn.id).length;
                return (
                  <button
                    key={conn.id}
                    onClick={() => setFilterTeam(conn.id)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '12px',
                      border: 'none',
                      fontSize: '12px',
                      cursor: 'pointer',
                      backgroundColor: filterTeam === conn.id ? getTeamColor(conn.id) : 'var(--bg-secondary)',
                      color: filterTeam === conn.id ? 'white' : 'var(--text-primary)'
                    }}
                  >
                    {conn.teamName} ({count})
                  </button>
                );
              })}
            </div>
          )}
          
          <div className="floating-content">
            {filteredNotifications.map((notification, index) => {
              const connection = connections.find((c) => c.id === notification.connectionId);
              return (
                <div key={index} className="notification-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: getTeamColor(notification.connectionId)
                    }} />
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                      {connection?.teamName}
                    </span>
                  </div>
                  <div className="notification-title">
                    {getEventLabel(notification.type)}
                  </div>
                  <div style={{ fontSize: '14px', marginTop: '4px' }}>
                    {notification.payload?.title || notification.payload?.name || ''}
                  </div>
                  <div className="notification-time">
                    {new Date(notification.timestamp).toLocaleTimeString('zh-CN')}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default FloatingWindow;
