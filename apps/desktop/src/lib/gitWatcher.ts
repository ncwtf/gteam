/**
 * Git 监控的前端接口。监听和持久化都在 Rust 侧，设置页关闭后仍会继续。
 * 访问令牌只传给本机命令，接口不会把它返回给界面。
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type RepoKind = 'local' | 'remote-https' | 'remote-ssh';
export type MonitorStatus = 'watching' | 'error';

export interface GitMonitor {
  id: string;
  connectionId: string;
  source: string;
  kind: RepoKind;
  followBranch: boolean;
  branch?: string | null;
  currentBranch?: string | null;
  requirementId?: string | null;
  hasAccessToken: boolean;
  status: MonitorStatus;
  statusMessage?: string | null;
  ownershipNote?: string | null;
  syncError?: string | null;
}

export interface GitSourceInspection {
  kind: RepoKind;
  normalizedSource: string;
  currentBranch?: string | null;
  ownershipNote?: string | null;
  hasCommits: boolean;
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

export interface GitMonitorStatusEvent {
  id: string;
  status: MonitorStatus;
  statusMessage?: string | null;
  ownershipNote?: string | null;
  currentBranch?: string | null;
  syncError?: string | null;
}

export interface AddGitMonitorInput {
  connectionId: string;
  source: string;
  followBranch: boolean;
  branch?: string | null;
  requirementId?: string | null;
  accessToken?: string | null;
}

export interface UpdateGitMonitorInput {
  id: string;
  followBranch: boolean;
  branch?: string | null;
  requirementId?: string | null;
  accessToken?: string | null;
  clearAccessToken?: boolean;
}

export function errorText(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '未知错误';
}

export async function listGitMonitors(): Promise<GitMonitor[]> {
  return await invoke('list_git_monitors');
}

export async function inspectGitSource(source: string): Promise<GitSourceInspection> {
  return await invoke('inspect_git_source', { source });
}

export async function addGitMonitor(input: AddGitMonitorInput): Promise<GitMonitor> {
  return await invoke('add_git_monitor', { request: input });
}

export async function updateGitMonitor(input: UpdateGitMonitorInput): Promise<GitMonitor> {
  return await invoke('update_git_monitor', { request: input });
}

export async function removeGitMonitor(id: string): Promise<void> {
  await invoke('remove_git_monitor', { id });
}

export async function pendingGitProgress(): Promise<GitProgressEvent[]> {
  return await invoke('pending_git_progress');
}

export async function ackGitProgress(id: string, hash: string): Promise<void> {
  await invoke('ack_git_progress', { id, hash });
}

export async function setGitSyncError(id: string, message: string | null): Promise<void> {
  await invoke('set_git_sync_error', { id, message });
}

export async function listenToGitProgress(
  callback: (event: GitProgressEvent) => void
): Promise<() => void> {
  return listen<GitProgressEvent>('git-progress', (event) => {
    callback(event.payload);
  });
}

export async function listenToGitMonitorStatus(
  callback: (event: GitMonitorStatusEvent) => void
): Promise<() => void> {
  return listen<GitMonitorStatusEvent>('git-monitor-status', (event) => {
    callback(event.payload);
  });
}
