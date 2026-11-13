/**
 * Git 监控器 - Tauri 前端接口
 * 实际监控逻辑在 Rust 后端实现
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface WatchedRepo {
  id: string;
  path: string;
  requirementId: string;
  connectionId: string;
  branch: string;
}

export interface GitProgressEvent {
  repo_path: string;
  branch: string;
  commit_hash: string;
  commit_message: string;
  author: string;
  timestamp: number;
}

/**
 * 开始监控 Git 仓库
 */
export async function startWatchingRepo(repoPath: string): Promise<void> {
  await invoke('start_watching_repo', { repoPath });
}

/**
 * 停止监控 Git 仓库
 */
export async function stopWatchingRepo(repoPath: string): Promise<void> {
  await invoke('stop_watching_repo', { repoPath });
}

/**
 * 获取当前 Git 状态
 */
export async function getCurrentGitStatus(repoPath: string): Promise<GitProgressEvent> {
  return await invoke('get_current_git_status', { repoPath });
}

/**
 * 监听 Git 进度事件
 */
export async function listenToGitProgress(
  callback: (event: GitProgressEvent) => void
): Promise<() => void> {
  const unlisten = await listen<GitProgressEvent>('git-progress', (event) => {
    callback(event.payload);
  });
  return unlisten;
}
