/**
 * Git 监控器
 * 监控本地 Git 仓库的变更，自动上报提交记录
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { watch } from 'chokidar';
import { createApiClient } from '../store';
import { TeamConnection } from '@teamctx/shared';

export interface WatchedRepo {
  id: string;
  path: string;
  requirementId: string;
  connectionId: string;
  branch: string;
}

class GitWatcher {
  private watchers: Map<string, any> = new Map();
  private watchedRepos: Map<string, WatchedRepo> = new Map();
  private lastCommits: Map<string, string> = new Map();

  /**
   * 添加监控的仓库
   */
  async addRepo(repo: WatchedRepo) {
    if (this.watchers.has(repo.id)) {
      console.log(`仓库已在监控中: ${repo.path}`);
      return;
    }

    this.watchedRepos.set(repo.id, repo);

    // 监控 .git 目录的变化
    const gitPath = `${repo.path}/.git/refs/heads/${repo.branch}`;
    const watcher = watch(gitPath, {
      persistent: true,
      ignoreInitial: false
    });

    watcher.on('change', async () => {
      await this.checkForNewCommits(repo.id);
    });

    this.watchers.set(repo.id, watcher);

    // 立即检查一次
    await this.checkForNewCommits(repo.id);

    console.log(`开始监控仓库: ${repo.path} (分支: ${repo.branch})`);
  }

  /**
   * 移除监控的仓库
   */
  async removeRepo(repoId: string) {
    const watcher = this.watchers.get(repoId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(repoId);
      this.watchedRepos.delete(repoId);
      this.lastCommits.delete(repoId);
      console.log(`停止监控仓库: ${repoId}`);
    }
  }

  /**
   * 检查新提交
   */
  private async checkForNewCommits(repoId: string) {
    const repo = this.watchedRepos.get(repoId);
    if (!repo) return;

    try {
      const git: SimpleGit = simpleGit(repo.path);
      
      // 获取当前分支最新提交
      const log = await git.log([repo.branch, '-1']);
      
      if (log.latest) {
        const latestHash = log.latest.hash;
        const lastReportedHash = this.lastCommits.get(repoId);

        // 如果是新提交，上报到服务器
        if (latestHash !== lastReportedHash) {
          await this.reportProgress(repo, log.latest);
          this.lastCommits.set(repoId, latestHash);
        }
      }
    } catch (error) {
      console.error(`检查提交失败 [${repo.path}]:`, error);
    }
  }

  /**
   * 上报进度到服务器
   */
  private async reportProgress(repo: WatchedRepo, commit: any) {
    try {
      // 从 store 获取连接信息
      const { useStore } = await import('../store');
      const connection = useStore.getState().connections.find(c => c.id === repo.connectionId);
      
      if (!connection) {
        console.error('未找到连接:', repo.connectionId);
        return;
      }

      const api = createApiClient(connection);
      
      await api.post('/api/git/progress', {
        requirementId: repo.requirementId,
        branch: repo.branch,
        repoPath: repo.path,
        commitHash: commit.hash,
        commitMessage: commit.message
      });

      console.log(`✅ Git 进度已上报: ${commit.hash.substring(0, 7)} - ${commit.message}`);
    } catch (error) {
      console.error('上报 Git 进度失败:', error);
    }
  }

  /**
   * 获取所有监控的仓库
   */
  getWatchedRepos(): WatchedRepo[] {
    return Array.from(this.watchedRepos.values());
  }

  /**
   * 清除所有监控
   */
  async clearAll() {
    for (const repoId of this.watchers.keys()) {
      await this.removeRepo(repoId);
    }
  }
}

// 单例
export const gitWatcher = new GitWatcher();
