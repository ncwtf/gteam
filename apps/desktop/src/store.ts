import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios, { AxiosInstance } from 'axios';
import {
  Project,
  Document,
  Requirement,
  Issue,
  WSEvent,
  WSEventType,
  TeamConnection
} from '@gteam/shared';
import { saveToken, removeToken, getAllTokens } from './lib/secureStore';

interface TeamData {
  projects: Project[];
  documents: Document[];
  requirements: Requirement[];
  issues: Issue[];
  notifications: WSEvent[];
  ws: WebSocket | null;
}

interface AppState {
  // 多团队连接
  connections: TeamConnection[];
  activeConnectionId: string | null;
  teamData: Record<string, TeamData>; // 按 connectionId 隔离数据
  
  // Actions
  addConnection: (connection: TeamConnection) => void;
  removeConnection: (connectionId: string) => void;
  setActiveConnection: (connectionId: string) => void;
  getActiveConnection: () => TeamConnection | null;
  updateConnection: (connectionId: string, updates: Partial<TeamConnection>) => void;
  
  // 团队数据操作
  setProjects: (connectionId: string, projects: Project[]) => void;
  setDocuments: (connectionId: string, documents: Document[]) => void;
  setRequirements: (connectionId: string, requirements: Requirement[]) => void;
  setIssues: (connectionId: string, issues: Issue[]) => void;
  addNotification: (connectionId: string, notification: WSEvent) => void;
  clearNotifications: (connectionId: string) => void;
  
  // WebSocket 管理
  connectWebSocket: (connectionId: string) => void;
  disconnectWebSocket: (connectionId: string) => void;
  disconnectAllWebSockets: () => void;
  
  // 聚合查询
  getAllNotifications: () => (WSEvent & { connectionId: string })[];
}

// 默认团队数据
const createDefaultTeamData = (): TeamData => ({
  projects: [],
  documents: [],
  requirements: [],
  issues: [],
  notifications: [],
  ws: null
});

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeConnectionId: null,
      teamData: {},

      addConnection: (connection) => {
        const existing = get().connections.find((c) => c.id === connection.id);
        if (existing) {
          // 同一服务器同一用户重新登录：只刷新 token，不重复添加
          get().disconnectWebSocket(connection.id);
          set((state) => ({
            connections: state.connections.map((c) =>
              c.id === connection.id ? { ...c, ...connection, joinedAt: c.joinedAt } : c
            ),
            activeConnectionId: connection.id
          }));
        } else {
          set((state) => ({
            connections: [...state.connections, connection],
            teamData: {
              ...state.teamData,
              [connection.id]: createDefaultTeamData()
            },
            activeConnectionId: connection.id
          }));
        }
        
        // token 不进 localStorage，单独存到本地安全存储，重启后恢复
        saveToken(connection.id, connection.token).catch((e) => console.warn('保存 token 失败', e));

        // 自动连接 WebSocket
        get().connectWebSocket(connection.id);
      },

      removeConnection: (connectionId) => {
        get().disconnectWebSocket(connectionId);
        removeToken(connectionId).catch(() => {});
        
        set((state) => {
          const newTeamData = { ...state.teamData };
          delete newTeamData[connectionId];
          
          return {
            connections: state.connections.filter((c) => c.id !== connectionId),
            teamData: newTeamData,
            activeConnectionId: state.activeConnectionId === connectionId 
              ? state.connections.find((c) => c.id !== connectionId)?.id || null
              : state.activeConnectionId
          };
        });
      },

      setActiveConnection: (connectionId) => {
        set((state) => ({
          connections: state.connections.map((c) => ({
            ...c,
            isActive: c.id === connectionId
          })),
          activeConnectionId: connectionId
        }));
      },

      getActiveConnection: () => {
        const state = get();
        return state.connections.find((c) => c.id === state.activeConnectionId) || null;
      },

      updateConnection: (connectionId, updates) => {
        set((state) => ({
          connections: state.connections.map((c) =>
            c.id === connectionId ? { ...c, ...updates } : c
          )
        }));
      },

      setProjects: (connectionId, projects) => {
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...(state.teamData[connectionId] || createDefaultTeamData()),
              projects
            }
          }
        }));
      },

      setDocuments: (connectionId, documents) => {
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...(state.teamData[connectionId] || createDefaultTeamData()),
              documents
            }
          }
        }));
      },

      setRequirements: (connectionId, requirements) => {
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...(state.teamData[connectionId] || createDefaultTeamData()),
              requirements
            }
          }
        }));
      },

      setIssues: (connectionId, issues) => {
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...(state.teamData[connectionId] || createDefaultTeamData()),
              issues
            }
          }
        }));
      },

      addNotification: (connectionId, notification) => {
        set((state) => {
          const teamData = state.teamData[connectionId];
          if (!teamData) return state;

          return {
            teamData: {
              ...state.teamData,
              [connectionId]: {
                ...teamData,
                notifications: [notification, ...teamData.notifications].slice(0, 50)
              }
            }
          };
        });
      },

      clearNotifications: (connectionId) => {
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...state.teamData[connectionId],
              notifications: []
            }
          }
        }));
      },

      connectWebSocket: (connectionId) => {
        const state = get();
        const connection = state.connections.find((c) => c.id === connectionId);
        const teamData = state.teamData[connectionId];
        
        if (!connection || !teamData || teamData.ws) return;

        const wsUrl = connection.serverUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
        const websocket = new WebSocket(wsUrl);

        websocket.onopen = () => {
          console.log(`WebSocket 已连接: ${connection.teamName}`);
          websocket.send(JSON.stringify({ type: 'auth', token: connection.token }));
        };

        websocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'auth_success') {
              console.log(`WebSocket 认证成功: ${connection.teamName}`);
              return;
            }

            if (data.type === 'auth_error') {
              console.error(`WebSocket 认证失败: ${connection.teamName}`, data.error);
              return;
            }

            // 处理实时事件
            const wsEvent = data as WSEvent;
            wsEvent.serverUrl = connection.serverUrl;
            wsEvent.teamName = connection.teamName;
            
            get().addNotification(connectionId, wsEvent);

            // 发送系统通知
            if (wsEvent.type === WSEventType.IssueCreated) {
              const issue = wsEvent.payload as Issue;
              if ((window as any).__TAURI__?.notification) {
                (window as any).__TAURI__.notification.sendNotification({
                  title: `[${connection.teamName}] 新问题`,
                  body: issue.title
                });
              }
            }
          } catch (error) {
            console.error('WebSocket 消息处理错误:', error);
          }
        };

        websocket.onerror = (error) => {
          console.error(`WebSocket 错误 [${connection.teamName}]:`, error);
        };

        websocket.onclose = () => {
          console.log(`WebSocket 已断开: ${connection.teamName}`);
          
          set((state) => ({
            teamData: {
              ...state.teamData,
              [connectionId]: {
                ...state.teamData[connectionId],
                ws: null
              }
            }
          }));

          // 重连逻辑
          setTimeout(() => {
            if (get().connections.find((c) => c.id === connectionId)) {
              get().connectWebSocket(connectionId);
            }
          }, 5000);
        };

        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...state.teamData[connectionId],
              ws: websocket
            }
          }
        }));
      },

      disconnectWebSocket: (connectionId) => {
        const state = get();
        const teamData = state.teamData[connectionId];
        
        if (teamData?.ws) {
          teamData.ws.close();
        }
      },

      disconnectAllWebSockets: () => {
        const state = get();
        Object.keys(state.teamData).forEach((connectionId) => {
          get().disconnectWebSocket(connectionId);
        });
      },

      getAllNotifications: () => {
        const state = get();
        const allNotifications: (WSEvent & { connectionId: string })[] = [];

        Object.entries(state.teamData).forEach(([connectionId, data]) => {
          data.notifications.forEach((notification) => {
            allNotifications.push({ ...notification, connectionId });
          });
        });

        // 按时间排序
        return allNotifications.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      }
    }),
    {
      name: 'gteam-storage',
      partialize: (state) => ({
        connections: state.connections.map((c) => ({
          ...c,
          // 不在 localStorage 中持久化 token，应使用系统 keychain
          token: '' // TODO: 使用 Tauri 的安全存储
        })),
        activeConnectionId: state.activeConnectionId
      })
    }
  )
);

// API 辅助函数 - 现在需要指定 connection
export function createApiClient(connection: TeamConnection): AxiosInstance {
  return axios.create({
    baseURL: connection.serverUrl,
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json'
    }
  });
}

/** 启动时从本地安全存储恢复各连接的 token（localStorage 里不保存 token） */
export async function hydrateTokens(): Promise<void> {
  // teamData 不持久化：为每个已保存的连接补上默认数据，避免访问 notifications 等字段时报错
  useStore.setState((state) => {
    const teamData = { ...state.teamData };
    for (const c of state.connections) {
      if (!teamData[c.id]) teamData[c.id] = createDefaultTeamData();
    }
    return { teamData };
  });
  try {
    const tokens = await getAllTokens();
    const { connections, updateConnection } = useStore.getState();
    for (const c of connections) {
      const saved = tokens[c.id]?.token;
      if (!c.token && saved) updateConnection(c.id, { token: saved });
    }
  } catch (e) {
    console.warn('恢复登录状态失败', e);
  }
}
