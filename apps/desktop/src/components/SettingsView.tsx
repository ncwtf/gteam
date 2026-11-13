import { useState } from 'react';
import { useStore } from '../store';

function SettingsView() {
  const { user, token } = useStore();
  const [activeTab, setActiveTab] = useState<'ide' | 'git' | 'about'>('ide');

  const ideConfigs = [
    {
      name: 'Cursor',
      path: '~/.cursor/mcp.json',
      config: {
        mcpServers: {
          teamctx: {
            command: 'node',
            args: ['/path/to/teamctx/packages/mcp-server/dist/cli.js'],
            env: {
              TEAMCTX_API_URL: 'http://localhost:3000',
              TEAMCTX_TOKEN: token || 'your-token'
            }
          }
        }
      }
    },
    {
      name: 'Claude Desktop',
      path: '~/.config/claude/mcp.json',
      config: {
        mcpServers: {
          teamctx: {
            command: 'node',
            args: ['/path/to/teamctx/packages/mcp-server/dist/cli.js'],
            env: {
              TEAMCTX_API_URL: 'http://localhost:3000',
              TEAMCTX_TOKEN: token || 'your-token'
            }
          }
        }
      }
    },
    {
      name: 'VS Code Copilot',
      path: 'settings.json',
      config: {
        'mcp.servers': {
          teamctx: {
            command: 'node',
            args: ['/path/to/teamctx/packages/mcp-server/dist/cli.js'],
            env: {
              TEAMCTX_API_URL: 'http://localhost:3000',
              TEAMCTX_TOKEN: token || 'your-token'
            }
          }
        }
      }
    }
  ];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('已复制到剪贴板');
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
          <div className="card">
            <div className="card-title">🔌 IDE MCP 配置</div>
            <div className="card-content" style={{ marginBottom: '16px' }}>
              选择你使用的 IDE，复制配置并添加到对应的配置文件中。
            </div>
            
            {ideConfigs.map((ide) => (
              <div key={ide.name} style={{ marginBottom: '24px' }}>
                <h3 style={{ marginBottom: '8px', fontSize: '16px', fontWeight: 600 }}>
                  {ide.name}
                </h3>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  配置文件: <code>{ide.path}</code>
                </div>
                <div style={{
                  position: 'relative',
                  backgroundColor: '#f5f5f5',
                  padding: '12px',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  overflow: 'auto'
                }}>
                  <pre style={{ margin: 0 }}>{JSON.stringify(ide.config, null, 2)}</pre>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(ide.config, null, 2))}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      padding: '4px 8px',
                      fontSize: '12px'
                    }}
                    className="btn btn-secondary"
                  >
                    复制
                  </button>
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
                  <label>监控的仓库路径</label>
                  <input type="text" placeholder="/path/to/your/repo" />
                </div>
                <button className="btn">添加仓库</button>
              </div>
            </div>
          </div>
          
          <div className="card">
            <div className="card-title">当前监控的仓库</div>
            <div className="card-content">
              <p style={{ color: 'var(--text-secondary)' }}>暂无监控的仓库</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'about' && (
        <div>
          <div className="card">
            <div className="card-title">关于 teamctx</div>
            <div className="card-content">
              <p style={{ marginBottom: '12px' }}>
                <strong>版本:</strong> 0.1.0 MVP
              </p>
              <p style={{ marginBottom: '12px' }}>
                <strong>当前用户:</strong> {user?.name} ({user?.email})
              </p>
              <p style={{ marginBottom: '12px' }}>
                <strong>Token:</strong> <code style={{
                  fontSize: '12px',
                  backgroundColor: 'var(--bg-secondary)',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}>
                  {token?.substring(0, 20)}...
                </code>
              </p>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                teamctx 是一个面向 AI 时代的团队协作工具，帮助团队成员和他们的 AI 助手之间无缝共享上下文信息。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsView;
