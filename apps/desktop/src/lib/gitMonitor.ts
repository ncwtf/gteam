/**
 * Git 监控的前端接口。
 * 监控本身在 Rust 里按团队持久化，并在应用启动时恢复。
 * 访问令牌只留在客户端，这里同步到团队服务器的内容不含令牌。
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import axios from 'axios';
import type { TeamConnection } from '@gteam/shared';
import { getTeamToken } from './keyring';
import { getToken } from './secureStore';

export interface GitMonitor {
  id: string;
  connectionId: string;
  kind: 'local' | 'wsl' | 'remote' | string;
  path: string;
  branchMode: 'follow' | 'pin' | string;
  branch: string | null;
  currentBranch: string | null;
  requirementId: string | null;
  hasToken: boolean;
  lastCommit: string | null;
  lastSubject: string | null;
  lastError: string | null;
}

export interface GitMonitorInput {
  location: string;
  followBranch: boolean;
  branch?: string;
  requirementId?: string;
  accessToken?: string;
  clearToken?: boolean;
}

export interface GitProgressEvent {
  repoId: string;
  connectionId: string;
  repoPath: string;
  branch: string;
  commitHash: string;
  commitMessage: string;
  author: string;
  timestamp: number;
  requirementId?: string | null;
}

export interface RequirementOption {
  id: string;
  title: string;
}

const syncedKeys = new Set<string>();

export function formatInvokeError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return '操作失败，请稍后重试。';
}

export async function listGitMonitors(): Promise<GitMonitor[]> {
  return invoke<GitMonitor[]>('list_git_monitors');
}

export async function addGitMonitor(connectionId: string, input: GitMonitorInput): Promise<GitMonitor> {
  return invoke<GitMonitor>('add_git_monitor', { input: toCommandInput(connectionId, input) });
}

export async function updateGitMonitor(id: string, input: GitMonitorInput): Promise<GitMonitor> {
  return invoke<GitMonitor>('update_git_monitor', {
    input: {
      id,
      ...toCommandInput(undefined, input),
      clearToken: Boolean(input.clearToken),
    },
  });
}

export async function removeGitMonitor(id: string): Promise<void> {
  await invoke('remove_git_monitor', { id });
}

export async function pickRepositoryFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择 Git 仓库文件夹',
  });
  if (typeof selected === 'string' && selected.trim()) {
    return selected;
  }
  return null;
}

export async function loadRequirementOptions(connection: TeamConnection): Promise<RequirementOption[]> {
  const token = await resolveTeamToken(connection);
  if (!token) return [];
  const api = axios.create({
    baseURL: connection.serverUrl,
    headers: { Authorization: `Bearer ${token}` },
  });
  const response = await api.get('/api/requirements');
  const rows = response.data?.data;
  if (!Array.isArray(rows)) return [];
  const options: RequirementOption[] = [];
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id : '';
    const title = typeof row?.title === 'string' ? row.title : '';
    if (id && title) options.push({ id, title });
  }
  return options;
}

export function listenToMonitorUpdates(onUpdate: (monitor: GitMonitor) => void): Promise<() => void> {
  return listen<GitMonitor>('git-monitor-updated', (event) => {
    onUpdate(event.payload);
  });
}

/**
 * 在应用根组件挂一次。设置页卸载后仍然接收提交并同步到对应团队。
 */
export async function startGitProgressSync(
  getConnections: () => TeamConnection[]
): Promise<() => void> {
  return listen<GitProgressEvent>('git-progress', (event) => {
    void syncProgress(event.payload, getConnections);
  });
}

async function syncProgress(event: GitProgressEvent, getConnections: () => TeamConnection[]): Promise<void> {
  const requirementId = event.requirementId?.trim();
  if (!requirementId || !event.commitHash || !event.connectionId) return;

  const key = `${event.connectionId}|${event.repoId}|${requirementId}|${event.commitHash}|${event.branch}`;
  if (syncedKeys.has(key)) return;
  syncedKeys.add(key);

  const connection = getConnections().find((item) => item.id === event.connectionId);
  if (!connection) {
    syncedKeys.delete(key);
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const token = await resolveTeamToken(connection);
      if (!token) {
        console.warn('未找到团队登录凭证，Git 提交记录暂不同步');
        return;
      }
      const api = axios.create({
        baseURL: connection.serverUrl,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      await api.post('/api/git/progress', {
        requirementId,
        branch: event.branch.slice(0, 255),
        repoPath: fitRepoPath(event.repoPath),
        commitHash: event.commitHash,
        commitMessage: event.commitMessage,
      });
      return;
    } catch (error) {
      if (attempt < 2) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      syncedKeys.delete(key);
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      console.warn(`同步 Git 提交记录失败${status ? `（${status}）` : ''}`);
    }
  }
}

function toCommandInput(connectionId: string | undefined, input: GitMonitorInput) {
  return {
    ...(connectionId ? { connectionId } : {}),
    location: input.location,
    followBranch: input.followBranch,
    branch: input.branch?.trim() ? input.branch.trim() : null,
    requirementId: input.requirementId?.trim() ? input.requirementId.trim() : null,
    accessToken: input.accessToken?.trim() ? input.accessToken.trim() : null,
  };
}

async function resolveTeamToken(connection: TeamConnection): Promise<string> {
  if (connection.token) return connection.token;
  try {
    const stored = await getTeamToken(connection.serverUrl);
    if (stored) return stored;
  } catch {
    // 钥匙串里没有该团队的登录凭证。
  }
  try {
    const stored = await getToken(connection.serverUrl);
    if (stored) return stored;
  } catch {
    // 本地配置里没有该团队的登录凭证。
  }
  return '';
}

function fitRepoPath(path: string): string {
  if (path.length <= 500) return path;
  return `…${path.slice(path.length - 499)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
