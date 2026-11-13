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
import { normalizeDocument, normalizeIssue, normalizeProject, normalizeRequirement } from './lib/normalize';

interface TeamData {
  projects: Project[];
  documents: Document[];
  requirements: Requirement[];
  issues: Issue[];
  notifications: WSEvent[];
  ws: WebSocket | null;
  projectsLoaded: boolean;
  projectsError: string | null;
  realtimeError: string | null;
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

  sessionNotice: string | null;
  setSessionNotice: (notice: string | null) => void;
  ensureTeamData: (connectionId: string) => void;
  setProjectsError: (connectionId: string, error: string) => void;
  setRealtimeError: (connectionId: string, error: string | null) => void;
}

// 默认团队数据
const createDefaultTeamData = (): TeamData => ({
  projects: [],
  documents: [],
  requirements: [],
  issues: [],
  notifications: [],
  ws: null,
  projectsLoaded: false,
  projectsError: null,
  realtimeError: null
});

function teamBucket(state: { teamData: Record<string, TeamData> }, connectionId: string): TeamData {
  return state.teamData[connectionId] || createDefaultTeamData();
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeConnectionId: null,
      teamData: {},
      sessionNotice: null,

      setSessionNotice: (notice) => set({ sessionNotice: notice }),

      ensureTeamData: (connectionId) => {
        set((state) => {
          if (state.teamData[connectionId]) return state;
          return {
            teamData: {
              ...state.teamData,
              [connectionId]: createDefaultTeamData()
            }
          };
        });
      },

      addConnection: (connection) => {
        set((state) => {
          const exists = state.connections.some((item) => item.id === connection.id);
          const connections = exists
            ? state.connections.map((item) => (
              item.id === connection.id
                ? { ...item, ...connection, isActive: true }
                : { ...item, isActive: false }
            ))
            : [...state.connections.map((item) => ({ ...item, isActive: false })), { ...connection, isActive: true }];
          return {
            connections,
            teamData: {
              ...state.teamData,
              [connection.id]: state.teamData[connection.id] || createDefaultTeamData()
            },
            activeConnectionId: connection.id
          };
        });

        get().connectWebSocket(connection.id);
      },

      removeConnection: (connectionId) => {
        get().disconnectWebSocket(connectionId);
        
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
        const list = (Array.isArray(projects) ? projects : []).map(normalizeProject);
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...teamBucket(state, connectionId),
              projects: list,
              projectsLoaded: true,
              projectsError: null
            }
          }
        }));
      },

      setProjectsError: (connectionId, error) => {
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...teamBucket(state, connectionId),
              projectsLoaded: true,
              projectsError: error
            }
          }
        }));
      },

      setRealtimeError: (connectionId, error) => {
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...teamBucket(state, connectionId),
              realtimeError: error
            }
          }
        }));
      },

      setDocuments: (connectionId, documents) => {
        const list = (Array.isArray(documents) ? documents : []).map(normalizeDocument);
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...teamBucket(state, connectionId),
              documents: list
            }
          }
        }));
      },

      setRequirements: (connectionId, requirements) => {
        const list = (Array.isArray(requirements) ? requirements : []).map(normalizeRequirement);
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...teamBucket(state, connectionId),
              requirements: list
            }
          }
        }));
      },

      setIssues: (connectionId, issues) => {
        const list = (Array.isArray(issues) ? issues : []).map(normalizeIssue);
        set((state) => ({
          teamData: {
            ...state.teamData,
            [connectionId]: {
              ...teamBucket(state, connectionId),
              issues: list
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
                notifications: [notification, ...(teamData.notifications || [])].slice(0, 50)
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
              ...teamBucket(state, connectionId),
              notifications: []
            }
          }
        }));
      },

      connectWebSocket: (connectionId) => {
        const state = get();
        const connection = state.connections.find((c) => c.id === connectionId);
        if (!connection?.token) return;

        if (!state.teamData[connectionId]) {
          set((current) => ({
            teamData: {
              ...current.teamData,
              [connectionId]: current.teamData[connectionId] || createDefaultTeamData()
            }
          }));
        }

        const teamData = get().teamData[connectionId];
        if (!teamData || teamData.ws) return;

        const wsUrl = connection.serverUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
        const websocket = new WebSocket(wsUrl);

        let authFailed = false;

        websocket.onopen = () => {
          console.log(`WebSocket 已连接: ${connection.teamName}`);
          websocket.send(JSON.stringify({ type: 'auth', token: connection.token }));
        };

        websocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'auth_success') {
              console.log(`WebSocket 认证成功: ${connection.teamName}`);
              get().setRealtimeError(connectionId, null);
              return;
            }

            if (data.type === 'auth_error') {
              authFailed = true;
              const message = data.error || '实时连接认证失败';
              console.error(`WebSocket 认证失败: ${connection.teamName}`, message);
              get().setRealtimeError(connectionId, message);
              websocket.close();
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

          set((current) => ({
            teamData: {
              ...current.teamData,
              [connectionId]: {
                ...teamBucket(current, connectionId),
                ws: null
              }
            }
          }));

          if (authFailed) return;
          setTimeout(() => {
            const current = get().connections.find((item) => item.id === connectionId);
            if (current?.token) get().connectWebSocket(connectionId);
          }, 5000);
        };

        set((current) => ({
          teamData: {
            ...current.teamData,
            [connectionId]: {
              ...teamBucket(current, connectionId),
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
          (data.notifications || []).forEach((notification) => {
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
