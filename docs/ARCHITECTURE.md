# gteam (God Team) 架构文档

## 核心设计理念

### 去中心化 + Discord 风格多团队

gteam (God Team) 采用**去中心化架构**，每个团队自托管独立的服务器，没有中心化 SaaS。桌面客户端采用 **Discord 风格**，可同时连接和切换多个团队。

### 设计目标

1. **数据主权**: 团队完全控制自己的数据
2. **隐私优先**: 数据不经过第三方服务器
3. **灵活扩展**: 团队可按需自托管和扩展
4. **无缝协作**: 一个客户端管理所有团队
5. **AI 友好**: 为 AI 协作优化的数据结构

## 系统架构

### 全局视图

```
┌─────────────────────────────────────────────────────────────────┐
│                      桌面客户端 (Tauri)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  团队侧边栏                                               │  │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                        │  │
│  │  │ TM1 │ │ TM2 │ │ TM3 │ │  +  │                        │  │
│  │  └─────┘ └─────┘ └─────┘ └─────┘                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────┬─────────────────────────────────────────────┐  │
│  │          │  主内容区                                    │  │
│  │  功能    │  - 项目列表                                  │  │
│  │  导航    │  - 文档管理                                  │  │
│  │          │  - 需求追踪                                  │  │
│  │  项目    │  - 问题协作                                  │  │
│  │  文档    │                                              │  │
│  │  需求    │                                              │  │
│  │  问题    │                                              │  │
│  │  设置    │                                              │  │
│  └──────────┴─────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  浮动通知窗口 (聚合所有团队)                             │  │
│  │  [全部] [Team1 (3)] [Team2 (1)] [Team3 (0)]            │  │
│  │  ● Team1: 新需求 "实现登录功能"                          │  │
│  │  ● Team2: Git 提交 "fix: 修复 bug"                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                          │ │ │
                          │ │ └────────────────┐
                          │ └──────────┐       │
                          │            │       │
                          ↓            ↓       ↓
                    ┌─────────┐  ┌─────────┐  ┌─────────┐
                    │ Server1 │  │ Server2 │  │ Server3 │
                    │ Team A  │  │ Team B  │  │ Team C  │
                    └────┬────┘  └────┬────┘  └────┬────┘
                         │            │            │
                    PostgreSQL   PostgreSQL   PostgreSQL
```

## 组件详解

### 1. 桌面客户端

#### 1.1 团队管理

```typescript
interface TeamConnection {
  id: string;              // 本地生成的连接 ID
  serverUrl: string;       // 团队服务器 URL (https://team.example.com)
  teamName: string;        // 显示名称
  token: string;           // JWT token (应存储在系统 keychain)
  userId: string;
  userName: string;
  isActive: boolean;       // 当前激活的团队
  joinedAt: Date;
  lastSyncAt?: Date;
}
```

**特点**:
- 客户端可同时连接多个团队
- 每个连接独立管理 (URL + token)
- Token 应存储在系统 keychain (当前未实现)

#### 1.2 数据隔离

```typescript
interface AppState {
  connections: TeamConnection[];           // 所有团队连接
  activeConnectionId: string | null;      // 当前激活的团队
  teamData: Record<string, TeamData>;     // 按 connectionId 隔离数据
}

interface TeamData {
  projects: Project[];
  documents: Document[];
  requirements: Requirement[];
  issues: Issue[];
  notifications: WSEvent[];
  ws: WebSocket | null;
}
```

**特点**:
- 数据按 `connectionId` 完全隔离
- 每个团队维护独立的 WebSocket 连接
- 通知跨团队聚合展示

#### 1.3 加入团队

两种方式:

1. **登录已有账号**
   - 输入服务器 URL + 邮箱/密码
   - 获取 token 后添加连接

2. **使用邀请链接**
   - `gteam://team.example.com?invite=abc123`
   - 或 `https://team.example.com/invite/abc123`
   - 自动注册并加入团队

### 2. 服务器 (每个团队独立部署)

#### 2.1 部署模型

```
每个团队 = 1个服务器实例 + 1个数据库

Team A (team-a.com)    Team B (team-b.internal)    Team C (localhost:3000)
     ↓                         ↓                            ↓
  Docker容器              物理服务器                    开发环境
     ↓                         ↓                            ↓
  PostgreSQL              PostgreSQL                   PostgreSQL
```

**特点**:
- 完全独立，互不依赖
- 可部署在公网、内网或本地
- 数据完全隔离，无共享

#### 2.2 API 设计

每个服务器提供相同的 REST API:

```
POST   /api/auth/login              # 登录
POST   /api/auth/register           # 注册
POST   /api/auth/create-invite      # 创建邀请码 (TODO)
POST   /api/auth/join-invite        # 使用邀请码加入 (TODO)

GET    /api/projects                # 列出项目
POST   /api/projects                # 创建项目
GET    /api/projects/:id            # 项目详情

GET    /api/documents               # 列出文档
POST   /api/documents               # 创建文档
PUT    /api/documents/:id           # 更新文档
DELETE /api/documents/:id           # 删除文档

GET    /api/requirements            # 列出需求
POST   /api/requirements            # 创建需求
PATCH  /api/requirements/:id/status # 更新状态

GET    /api/issues                  # 列出问题
POST   /api/issues                  # 创建问题
POST   /api/issues/:id/replies      # 回复问题

POST   /api/git/progress            # 报告 Git 进度
GET    /api/git/progress/:reqId     # 获取进度
```

#### 2.3 WebSocket 推送

每个服务器独立维护 WebSocket 连接:

```typescript
// 客户端
ws1 = new WebSocket('wss://team-a.com:3001')
ws2 = new WebSocket('wss://team-b.com:3001')
ws3 = new WebSocket('ws://localhost:3001')

// 认证
ws.send({ type: 'auth', token: 'xxx' })

// 接收事件
ws.onmessage = (event) => {
  const wsEvent: WSEvent = JSON.parse(event.data)
  // wsEvent.teamName 标识来源团队
}
```

### 3. MCP 服务器

#### 3.1 多团队配置

```json
{
  "teams": [
    {
      "serverUrl": "https://team-a.com",
      "token": "token-a",
      "teamName": "TeamA"
    },
    {
      "serverUrl": "https://team-b.com",
      "token": "token-b",
      "teamName": "TeamB"
    }
  ],
  "defaultTeam": "TeamA"
}
```

#### 3.2 工具设计

所有工具接受可选的 `team` 参数:

```typescript
// 不提供 team 参数 -> 使用默认团队
await mcp.callTool('list_projects', {})

// 指定团队 (serverUrl 或 teamName)
await mcp.callTool('list_projects', { team: 'TeamA' })
await mcp.callTool('list_projects', { team: 'https://team-a.com' })
```

#### 3.3 跨团队操作

```typescript
// AI 可以跨团队操作

// 从 TeamA 读取需求
const requirements = await mcp.callTool('list_requirements', {
  projectId: 'proj-a',
  team: 'TeamA'
})

// 在 TeamB 创建相关文档
await mcp.callTool('write_doc', {
  projectId: 'proj-b',
  title: '需求分析',
  content: '基于 TeamA 的需求...',
  partition: 'collaborative',
  team: 'TeamB'
})
```

## 权限模型

### 三层分区

| 分区 | 所有者权限 | 团队成员权限 | 说明 |
|-----|----------|------------|------|
| **Personal** | 读写 | 只读 | 个人工作区，他人只能查看 |
| **Shared** | 读写 | 只读 | 策划文档、规范，集中维护 |
| **Collaborative** | 读写 | 读写 | 协作区域，所有人可编辑 |

### 权限检查流程

```typescript
// 1. 检查用户是否是项目成员
const isMember = await checkTeamMembership(userId, projectId)
if (!isMember) return { allowed: false }

// 2. 检查是否是管理员
const isAdmin = await checkAdminRole(userId, projectId)
if (isAdmin) return { allowed: true }

// 3. 根据分区和操作检查权限
if (partition === 'personal') {
  if (action === 'read') return { allowed: true }
  if (action === 'write') return { allowed: userId === ownerId }
}

if (partition === 'shared') {
  if (action === 'read') return { allowed: true }
  if (action === 'write') return { allowed: userId === ownerId }
}

if (partition === 'collaborative') {
  if (action === 'read' || action === 'write') return { allowed: true }
  if (action === 'delete') return { allowed: userId === ownerId || isAdmin }
}
```

## 数据流

### 创建文档流程

```
┌──────────┐    1. 用户操作      ┌──────────┐
│  客户端  │ ─────────────────→ │ 界面组件 │
└──────────┘                     └─────┬────┘
                                       │ 2. 调用 API
                                       ↓
                              ┌────────────────┐
                              │ createApiClient│
                              │ (connection)   │
                              └────────┬───────┘
                                       │ 3. HTTP POST
                                       ↓
                              ┌────────────────┐
                              │  Team Server   │
                              │ POST /api/docs │
                              └────────┬───────┘
                                       │ 4. 权限检查
                                       ↓
                              ┌────────────────┐
                              │ PermissionCheck│
                              └────────┬───────┘
                                       │ 5. 数据库操作
                                       ↓
                              ┌────────────────┐
                              │   PostgreSQL   │
                              └────────┬───────┘
                                       │ 6. 广播事件
                                       ↓
                              ┌────────────────┐
                              │  broadcastEvent│
                              └────────┬───────┘
                                       │ 7. WebSocket
                ┌──────────────────────┼──────────────────────┐
                ↓                      ↓                      ↓
          ┌──────────┐          ┌──────────┐          ┌──────────┐
          │ 客户端 A │          │ 客户端 B │          │ 客户端 C │
          └──────────┘          └──────────┘          └──────────┘
               │                     │                     │
               ↓                     ↓                     ↓
          添加通知              添加通知              添加通知
```

## 安全考虑

### 1. Token 存储

**当前状态** (v0.2.0):
- ❌ 存储在 localStorage (不安全)

**计划实现** (v0.3.0):
- ✅ macOS: Keychain
- ✅ Windows: Credential Manager
- ✅ Linux: Secret Service API

### 2. 通信安全

- 生产环境必须使用 HTTPS
- WebSocket 使用 WSS
- JWT token 设置合理过期时间

### 3. 数据隔离

- 客户端: 按 `connectionId` 完全隔离
- 服务器: 按 `teamId` 完全隔离
- MCP: 按 API 客户端实例隔离

## 扩展性

### 横向扩展

每个团队服务器可独立扩展:

```
Team A:
  ├── Load Balancer (Nginx/Caddy)
  ├── App Server 1
  ├── App Server 2
  ├── App Server 3
  └── PostgreSQL (Primary + Replicas)
```

### 未来计划

1. **团队间互联** - 可选的跨团队项目链接
2. **P2P 同步** - 客户端之间直接同步（离线优先）
3. **联邦协议** - 标准化的团队间通信协议
4. **区块链** - 可选的工作量证明和贡献追踪

## 技术栈总结

| 组件 | 技术 | 说明 |
|-----|------|------|
| 桌面客户端 | Tauri 2 + React + TypeScript + Zustand | 跨平台，多团队状态管理 |
| 服务器 | Node.js + Express + WebSocket + PostgreSQL | 每个团队独立部署 |
| MCP 服务器 | @modelcontextprotocol/sdk + Axios | 多团队 API 客户端管理 |
| 部署 | Docker Compose | 一键部署团队服务器 |
| CI/CD | GitHub Actions | 多平台构建和测试 |
