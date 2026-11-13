import { useState, useEffect } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { useStore } from '../store';
import InviteCard from './InviteCard';
import { supportedIDEs, writeIDEConfig, copyIDEConfigToClipboard } from '../lib/ideConfig';
import { startWatchingRepo, stopWatchingRepo, listenToGitProgress, type GitProgressEvent } from '../lib/gitWatcher';
import {
  checkForUpdate,
  formatProgress,
  formatVersion,
  getCurrentVersion,
  installAndRelaunch,
} from '../lib/updater';

interface WatchedRepo {
  id: string;
  path: string;
  requirementId: string;
  connectionId: string;
  branch: string;
}

function SettingsView() {
  const { connections, getActiveConnection, removeConnection } = useStore();
  const activeConnection = getActiveConnection();
  const [activeTab, setActiveTab] = useState<'ide' | 'git' | 'about'>('ide');
  const [ideMessage, setIdeMessage] = useState('');
  const [gitRepoPath, setGitRepoPath] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [requirementId, setRequirementId] = useState('');
  const [watchedRepos, setWatchedRepos] = useState<WatchedRepo[]>([]);
  const [appVersion, setAppVersion] = useState('…');
  const [updateMessage, setUpdateMessage] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);

  useEffect(() => {
    getCurrentVersion().then((version) => {
      setAppVersion(version ? formatVersion(version) : '未知');
    });
  }, []);

  useEffect(() => {
    // 监听 Git 进度事件
    let unlisten: (() => void) | undefined;
    
    listenToGitProgress((event: GitProgressEvent) => {
      console.log('Git progress:', event);
      // 可以在这里上报到服务器或更新 UI
    }).then(fn => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Example IDE configs (not used, removed to fix TypeScript errors)

  const handleWriteIDEConfig = async (ide: typeof supportedIDEs[0]) => {
    setIdeMessage('写入中...');
    const result = await writeIDEConfig(ide, connections);
    setIdeMessage(result.message);
    setTimeout(() => setIdeMessage(''), 5000);
  };

  const handleCopyIDEConfig = async (ide: typeof supportedIDEs[0]) => {
    await copyIDEConfigToClipboard(ide, connections);
    setIdeMessage(`${ide.name} 配置已复制到剪贴板`);
    setTimeout(() => setIdeMessage(''), 3000);
  };

  const handleAddGitRepo = async () => {
    if (!activeConnection || !gitRepoPath || !gitBranch || !requirementId) {
      alert('请填写所有字段');
      return;
    }

    try {
      const repo: WatchedRepo = {
        id: `${activeConnection.id}-${gitRepoPath}`,
        path: gitRepoPath,
        requirementId,
        connectionId: activeConnection.id,
        branch: gitBranch
      };

      await startWatchingRepo(gitRepoPath);
      setWatchedRepos([...watchedRepos, repo]);
      setGitRepoPath('');
      setGitBranch('');
      setRequirementId('');
    } catch (error) {
      alert(`添加监控失败: ${error}`);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateMessage('');
    const result = await checkForUpdate();
    if (result.status === 'latest') {
      setAvailableUpdate(null);
      setUpdateMessage('已是最新版本');
    } else if (result.status === 'update') {
      setAvailableUpdate(result.update);
      setUpdateMessage(`发现新版本 ${formatVersion(result.update.version)}`);
    } else {
      setAvailableUpdate(null);
      setUpdateMessage('暂时无法检查更新');
    }
    setCheckingUpdate(false);
  };

  const handleInstallUpdate = async () => {
    if (!availableUpdate) return;
    setInstallingUpdate(true);
    setUpdateMessage('正在下载...');
    try {
      await installAndRelaunch(availableUpdate, (progress) => {
        setUpdateMessage(formatProgress(progress));
      });
    } catch (error) {
      console.warn('安装更新失败', error);
      setUpdateMessage('更新失败');
      setInstallingUpdate(false);
    }
  };

  const handleRemoveGitRepo = async (repoId: string) => {
    const repo = watchedRepos.find(r => r.id === repoId);
    if (!repo) return;

    try {
      await stopWatchingRepo(repo.path);
      setWatchedRepos(watchedRepos.filter(r => r.id !== repoId));
    } catch (error) {
      alert(`移除监控失败: ${error}`);
    }
  };

  return (
    <div>
      <div className="header">
        <h1>设置</h1>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <button
          className={activeTab === 'ide' ? 'btn' : 'btn btn-secondary'}
          onClick={() => setActiveTab('ide')}
        >
          IDE 连接
        </button>
        <button
          className={activeTab === 'git' ? 'btn' : 'btn btn-secondary'}
          onClick={() => setActiveTab('git')}
        >
          Git 监控
        </button>
        <button
          className={activeTab === 'about' ? 'btn' : 'btn btn-secondary'}
          onClick={() => setActiveTab('about')}
        >
          关于
        </button>
      </div>

      {activeTab === 'ide' && (
        <div>
          {ideMessage && (
            <div className="card" style={{ backgroundColor: '#e6f4ea', borderColor: '#00aa00', marginBottom: '16px' }}>
              {ideMessage}
            </div>
          )}

          <div className="card">
            <div className="card-title">🔌 IDE MCP 配置</div>
            <div className="card-content" style={{ marginBottom: '16px' }}>
              一键配置或复制配置到你使用的 IDE。当前已连接 {connections.length} 个团队。
            </div>
            
            {supportedIDEs.map((ide) => (
              <div key={ide.name} style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                  <div>
                    <h3 style={{ marginBottom: '4px', fontSize: '16px', fontWeight: 600 }}>
                      {ide.name}
                    </h3>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                      {ide.description}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      配置文件: <code style={{ backgroundColor: 'white', padding: '2px 6px', borderRadius: '4px' }}>{ide.configPath}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleWriteIDEConfig(ide)}
                      className="btn"
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                    >
                      一键配置
                    </button>
                    <button
                      onClick={() => handleCopyIDEConfig(ide)}
                      className="btn btn-secondary"
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                    >
                      复制配置
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'git' && (
        <div>
          <div className="card">
            <div className="card-title">🌿 Git 监控设置</div>
            <div className="card-content">
              Git 监控会自动追踪你的本地代码仓库变化，并将提交记录同步到团队。
              <div style={{ marginTop: '16px' }}>
                <div className="form-group">
                  <label>仓库路径 *</label>
                  <input 
                    type="text" 
                    placeholder="/path/to/your/repo" 
                    value={gitRepoPath}
                    onChange={(e) => setGitRepoPath(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Git 分支 *</label>
                  <input 
                    type="text" 
                    placeholder="feature/my-feature" 
                    value={gitBranch}
                    onChange={(e) => setGitBranch(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>关联需求 ID *</label>
                  <input 
                    type="text" 
                    placeholder="需求 ID" 
                    value={requirementId}
                    onChange={(e) => setRequirementId(e.target.value)}
                  />
                  <small style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                    该仓库的提交将关联到此需求
                  </small>
                </div>
                <button className="btn" onClick={handleAddGitRepo}>添加仓库</button>
              </div>
            </div>
          </div>
          
          <div className="card">
            <div className="card-title">当前监控的仓库 ({watchedRepos.length})</div>
            <div className="card-content">
              {watchedRepos.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>暂无监控的仓库</p>
              ) : (
                watchedRepos.map((repo) => {
                  const connection = connections.find(c => c.id === repo.connectionId);
                  return (
                    <div key={repo.id} style={{ 
                      padding: '12px', 
                      backgroundColor: 'var(--bg-secondary)', 
                      borderRadius: '6px', 
                      marginBottom: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{repo.path}</div>
                        <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          分支: {repo.branch} | 团队: {connection?.teamName} | 需求: {repo.requirementId}
                        </div>
                      </div>
                      <button 
                        className="btn btn-secondary" 
                        onClick={() => handleRemoveGitRepo(repo.id)}
                        style={{ fontSize: '14px', padding: '6px 12px' }}
                      >
                        移除
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'about' && (
        <div>
          <div className="card">
            <div className="card-title">关于 gteam (God Team)</div>
            <div className="card-content">
              <p style={{ marginBottom: '12px' }}>
                <strong>版本:</strong> {appVersion}
              </p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                <button
                  className="btn"
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate || installingUpdate}
                >
                  {checkingUpdate ? '检查中...' : '检查更新'}
                </button>
                {availableUpdate && (
                  <button
                    className="btn btn-secondary"
                    onClick={handleInstallUpdate}
                    disabled={installingUpdate}
                  >
                    立即更新
                  </button>
                )}
              </div>
              {updateMessage && (
                <p style={{ marginBottom: '12px' }}>{updateMessage}</p>
              )}
              <p style={{ marginBottom: '12px' }}>
                <strong>已连接团队:</strong> {connections.length} 个
              </p>
              <p style={{ marginBottom: '12px' }}>
                <strong>当前团队:</strong> {activeConnection?.teamName}
              </p>
              <p style={{ marginBottom: '12px' }}>
                <strong>当前用户:</strong> {activeConnection?.userName}
              </p>
              {activeConnection && <InviteCard connection={activeConnection} />}
              {activeConnection && (
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: '12px' }}
                  onClick={() => {
                    if (window.confirm(`确定要移除团队「${activeConnection.teamName}」吗？（只删除本机的连接，不影响服务器数据）`)) {
                      removeConnection(activeConnection.id);
                    }
                  }}
                >
                  移除此团队
                </button>
              )}
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: '16px' }}>
                gteam (God Team) 是一个去中心化的团队协作工具，采用 Discord 风格的多团队架构。每个团队自托管独立服务器，桌面客户端可同时连接多个团队，帮助团队成员和他们的 AI 助手之间无缝共享上下文信息。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsView;
