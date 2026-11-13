/**
 * 把后台监听到的提交同步到对应团队。没有需求 ID 时不同步。
 * 这里发出去的内容只有仓库地址、分支和提交信息，不包含访问令牌。
 */

import { useEffect } from 'react';
import axios from 'axios';
import { createApiClient, useStore } from '../store';
import type { TeamConnection } from '@gteam/shared';
import { getTeamToken } from './keyring';
import { getToken } from './secureStore';
import {
  ackGitProgress,
  listenToGitProgress,
  pendingGitProgress,
  setGitSyncError,
  type GitProgressEvent,
} from './gitWatcher';

const posted = new Set<string>();
const acked = new Set<string>();
const inflight = new Map<string, Promise<boolean>>();

async function resolveToken(connection: TeamConnection): Promise<string> {
  if (connection.token) return connection.token;
  try {
    const stored = await getTeamToken(connection.serverUrl);
    if (stored) return stored;
  } catch {
    // 系统钥匙串里没有团队令牌时会失败，继续尝试本地安全存储。
  }
  try {
    return (await getToken(connection.serverUrl)) ?? '';
  } catch {
    return '';
  }
}

async function postProgress(event: GitProgressEvent): Promise<boolean> {
  const requirementId = event.requirementId?.trim();
  if (!requirementId) return true;

  const connection = useStore.getState().connections.find((item) => item.id === event.connectionId);
  if (!connection) return false;
  const token = await resolveToken(connection);
  if (!token) {
    await setGitSyncError(event.repoId, '团队登录已失效，提交暂存在本机，重新连接团队后会继续同步。').catch(() => undefined);
    return false;
  }

  const key = `${event.repoId}:${event.commitHash}`;
  if (!posted.has(key)) {
    try {
      await createApiClient({ ...connection, token }).post('/api/git/progress', {
        requirementId,
        branch: event.branch,
        repoPath: event.repoPath,
        commitHash: event.commitHash,
        commitMessage: event.commitMessage,
      });
      posted.add(key);
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const message = status === 400 || status === 404
        ? '同步失败：需求 ID 不存在或无权访问。可以在列表里修改。'
        : '提交已记录在本机，但同步到团队失败。请检查网络和登录状态。';
      await setGitSyncError(event.repoId, message).catch(() => undefined);
      return false;
    }
  }

  try {
    await ackGitProgress(event.repoId, event.commitHash);
    await setGitSyncError(event.repoId, null).catch(() => undefined);
    return true;
  } catch {
    await setGitSyncError(event.repoId, '提交已同步，但本机确认失败，将自动重试。').catch(() => undefined);
    return false;
  }
}

export function syncGitProgress(event: GitProgressEvent): Promise<boolean> {
  const key = `${event.repoId}:${event.commitHash}`;
  if (acked.has(key)) return Promise.resolve(true);
  const existing = inflight.get(key);
  if (existing) return existing;
  const task = postProgress(event)
    .then((ok) => {
      if (ok) acked.add(key);
      return ok;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, task);
  return task;
}

async function drainPending(): Promise<void> {
  try {
    const pending = await pendingGitProgress();
    for (const event of pending) {
      await syncGitProgress(event);
    }
  } catch (error) {
    console.warn('读取待同步的 Git 提交失败', error instanceof Error ? error.message : '未知错误');
  }
}

export function useGitProgressSync(): void {
  const connectionKey = useStore((state) =>
    state.connections.map((connection) => `${connection.id}:${connection.token ? '1' : '0'}:${connection.serverUrl}`).join('|')
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let stopped = false;
    listenToGitProgress((event) => {
      void syncGitProgress(event);
    }).then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    }).catch((error) => {
      console.warn('无法订阅 Git 进度', error instanceof Error ? error.message : '未知错误');
    });

    void drainPending();
    const timer = window.setInterval(() => {
      void drainPending();
    }, 20000);

    return () => {
      stopped = true;
      unlisten?.();
      window.clearInterval(timer);
    };
  }, [connectionKey]);
}
