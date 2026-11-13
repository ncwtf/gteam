
interface LoginProps {
  onAddTeam: () => void;
}

function Login({ onAddTeam }: LoginProps) {
  return (
    <div className="login-container">
      <div className="login-box">
        <h1 className="login-title">gteam</h1>
        <p style={{ 
          textAlign: 'center', 
          color: 'var(--text-secondary)', 
          marginBottom: '32px',
          lineHeight: '1.6'
        }}>
          AI 时代的团队协作工具
          <br />
          <small>去中心化 · 多团队 · 自托管</small>
        </p>
        
        <button 
          onClick={onAddTeam}
          className="btn" 
          style={{ width: '100%', marginBottom: '16px' }}
        >
          + 连接团队服务器
        </button>
        
        <div style={{ 
          marginTop: '24px', 
          padding: '16px', 
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '8px',
          fontSize: '14px',
          color: 'var(--text-secondary)'
        }}>
          <p style={{ marginBottom: '12px', fontWeight: 500 }}>💡 使用说明：</p>
          <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
            <li>每个团队自托管独立的服务器</li>
            <li>可同时连接多个团队（Discord 风格）</li>
            <li>支持邀请链接和 gteam:// 深链接</li>
            <li>数据在本地按团队隔离</li>
          </ul>
        </div>
        
        <div style={{ 
          marginTop: '16px', 
          textAlign: 'center',
          fontSize: '12px',
          color: 'var(--text-secondary)'
        }}>
          需要自托管服务器？查看文档了解部署方法
        </div>
      </div>
    </div>
  );
}

export default Login;
