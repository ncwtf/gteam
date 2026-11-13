import { useState, useEffect, type CSSProperties } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { useStore } from '../store';
import InviteCard from './InviteCard';
import GitMonitorPanel from './GitMonitorPanel';
import {
  configureIde,
  copyIdeConfig,
  inspectIdes,
  removeIde,
  statusLabel,
  type IdeConfigStatus,
  type IdeId,
  type IdeInspection,
} from '../lib/ideConfig';
import {
  checkForUpdate,
  formatProgress,
  formatVersion,
  getCurrentVersion,
  installAndRelaunch,
} from '../lib/updater';

function SettingsView() {
  const { connections, activeConnectionId, getActiveConnection } = useStore();
  const activeConnection = getActiveConnection();
  const [activeTab, setActiveTab] = useState<'ide' | 'git' | 'about'>('ide');
  const [ideMessage, setIdeMessage] = useState('');
  const [ideMessageOk, setIdeMessageOk] = useState(true);
  const [ideInspections, setIdeInspections] = useState<IdeInspection[]>([]);
  const [ideBusy, setIdeBusy] = useState<IdeId | null>(null);
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

  const refreshIdes = async () => {
    try {
      setIdeInspections(await inspectIdes(connections, activeConnectionId));
    } catch (error) {
      console.warn('读取 IDE 配置失败', error);
    }
  };

  useEffect(() => {
    if (activeTab !== 'ide') return;
    refreshIdes();
  }, [activeTab, connections, activeConnectionId]);

  const showIdeResult = (success: boolean, message: string) => {
    setIdeMessageOk(success);
    setIdeMessage(message);
    setTimeout(() => setIdeMessage(''), 5000);
  };

  const handleConfigureIde = async (id: IdeId) => {
    setIdeBusy(id);
    const result = await configureIde(id, connections, activeConnectionId);
    showIdeResult(result.success, result.message);
    await refreshIdes();
    setIdeBusy(null);
  };

  const handleRemoveIde = async (id: IdeId) => {
    setIdeBusy(id);
    const result = await removeIde(id);
    showIdeResult(result.success, result.message);
    await refreshIdes();
    setIdeBusy(null);
  };

  const handleCopyIde = async (id: IdeId) => {
    try {
      await copyIdeConfig(id, connections, activeConnectionId);
      const name = ideInspections.find((ide) => ide.id === id)?.name ?? id;
      showIdeResult(true, `${name} 配置已复制到剪贴板`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showIdeResult(false, `复制失败: ${message}`);
    }
  };

  const configureLabel = (status: IdeConfigStatus) => {
    if (status === 'needs_repair') return '修复';
    if (status === 'configured') return '更新配置';
    return '一键配置';
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
            <div
              className="card"
              style={{
                backgroundColor: ideMessageOk ? '#e6f4ea' : '#fdecea',
                borderColor: ideMessageOk ? '#00aa00' : '#d93025',
                marginBottom: '16px',
              }}
            >
              {ideMessage}
            </div>
          )}

          <div className="card">
            <div className="card-title">🔌 IDE MCP 配置</div>
            <div className="card-content" style={{ marginBottom: '16px' }}>
              把当前 {connections.length} 个团队写进 IDE 的用户级 MCP 配置。程序随 gteam 一起安装，不需要本机另装 Node.js，也不会指向源码目录。已有的 gteam 项会被更新，其他 MCP 服务器保持原样。
            </div>

            {ideInspections.map((ide) => (
              <div key={ide.id} style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '12px' }}>
                  <div>
                    <h3 style={{ marginBottom: '4px', fontSize: '16px', fontWeight: 600 }}>
                      {ide.name}
                      <span style={statusStyle(ide.status)}>{statusLabel(ide.status)}</span>
                    </h3>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                      {ide.description}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      配置文件: <code style={{ backgroundColor: 'white', padding: '2px 6px', borderRadius: '4px' }}>{ide.configPath}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                      onClick={() => handleConfigureIde(ide.id)}
                      className="btn"
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                      disabled={ideBusy !== null || connections.length === 0}
                    >
                      {ideBusy === ide.id ? '写入中...' : configureLabel(ide.status)}
                    </button>
                    <button
                      onClick={() => handleRemoveIde(ide.id)}
                      className="btn btn-secondary"
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                      disabled={ideBusy !== null || ide.status === 'unconfigured'}
                    >
                      移除
                    </button>
                    <button
                      onClick={() => handleCopyIde(ide.id)}
                      className="btn btn-secondary"
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                      disabled={ideBusy !== null || connections.length === 0}
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

      {activeTab === 'git' && <GitMonitorPanel />}

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

function statusStyle(status: IdeConfigStatus): CSSProperties {
  const color = status === 'configured' ? '#0d7a32' : status === 'needs_repair' ? '#b06000' : '#666';
  const background = status === 'configured' ? '#e6f4ea' : status === 'needs_repair' ? '#fff4e5' : '#f1f3f4';
  return {
    marginLeft: '8px',
    fontSize: '12px',
    fontWeight: 600,
    color,
    background,
    borderRadius: '999px',
    padding: '2px 8px',
    verticalAlign: 'middle',
  };
}

export default SettingsView;
