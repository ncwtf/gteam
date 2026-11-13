# gteam (God Team)

**AI 时代的去中心化团队协作工具** - 跨平台桌面应用 + 自托管服务 + MCP 服务器

gteam 帮助团队成员和他们的 AI 助手无缝共享上下文信息，解决多人多 AI 协作中信息流失的问题。

## ✨ 核心特性

- 🌐 **去中心化架构** - 每个团队自托管独立服务器，无中心化 SaaS
- 🎯 **Discord 风格多团队** - 一个客户端同时连接多个团队，自由切换
- 📁 **项目和文档管理** - 结构化的团队知识库，为 AI 优化
- ✅ **需求追踪** - 需求与 Git 分支绑定，实时同步进度
- 🔔 **聚合实时通知** - 跨团队聚合通知，带团队标识和筛选
- 🤖 **MCP 多团队集成** - AI 助手可跨团队读写上下文，支持多种 IDE
- 🔒 **权限分区** - Personal（个人）/ Shared（只读）/ Collaborative（协作）三层模型
- 🌿 **Git 监控** - 自动追踪本地代码提交，团队可见工作进度
- 🖥️ **跨平台桌面应用** - macOS / Windows / Linux，浮动窗口 + 系统托盘
- 🔗 **深链接支持** - gteam:// 协议和邀请链接，一键加入团队

## 🏗️ 架构

### 去中心化多团队架构

```
┌─────────────────────────────────────────────────────────┐
│  桌面客户端 (Tauri + React)                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │  Team A  │ │  Team B  │ │  Team C  │  (Discord 风格)│
│  └─────┬────┘ └─────┬────┘ └─────┬────┘                │
│        │            │            │                      │
└────────┼────────────┼────────────┼──────────────────────┘
         │            │            │
         ↓            ↓            ↓
    ┌────────┐   ┌────────┐   ┌────────┐
    │Server A│   │Server B│   │Server C│  (每个团队自托管)
    └────────┘   └────────┘   └────────┘
         │            │            │
         ↓            ↓            ↓
    PostgreSQL   PostgreSQL   PostgreSQL
```

### 项目结构

```
gteam/
├── apps/
│   ├── server/          # 后端服务 (每个团队部署一份)
│   │   ├── REST API     # 项目/文档/需求/问题 CRUD
│   │   └── WebSocket    # 实时事件推送
│   └── desktop/         # 桌面应用 (连接多个团队)
│       ├── 团队侧边栏    # Discord 风格团队切换
│       ├── 浮动通知窗口  # 聚合所有团队通知
│       └── 数据隔离      # 按团队分离本地缓存
├── packages/
│   ├── shared/          # 共享类型定义
│   └── mcp-server/      # MCP 服务器 (多团队感知)
└── docs/                # 文档
```

### 数据模型 (每个服务器独立)

```
Organization / Team (自托管服务器)
  ├── Projects (可互相链接)
  │   ├── Documents (三层权限分区)
  │   ├── Requirements (绑定 Git 分支)
  │   └── Issues (人工 + AI 提问)
  └── Members (角色: UI / 产品 / 后端 / 前端)
```

### 权限模型

| 分区 | 所有者 | 团队成员 | 说明 |
|-----|--------|---------|------|
| **Personal** | 读写 | 只读 | 个人工作空间 |
| **Shared** | 读写 | 只读 | 策划文档、规范 |
| **Collaborative** | 读写 | 读写 | 协作区域 |

## 🚀 快速开始

### 架构概览

1. **服务器**: 每个团队自托管一个服务器实例
2. **客户端**: 一个桌面客户端可连接多个团队服务器
3. **MCP**: AI 可通过 MCP 服务器跨团队访问上下文

### 环境要求

- Node.js 18+
- pnpm 8+
- Rust (用于桌面应用构建)
- Docker + Docker Compose (推荐，用于部署团队服务器)
- PostgreSQL 16+ (每个团队服务器一个数据库)

### 安装依赖

```bash
# 安装 pnpm (如果未安装)
npm install -g pnpm

# 安装项目依赖
pnpm install

# 构建所有包
pnpm build
```

### 启动开发环境

#### 1. 启动数据库

```bash
# 使用 Docker
docker-compose up postgres

# 或手动启动 PostgreSQL
# 确保创建数据库: gteam
```

#### 2. 启动后端服务

```bash
# 复制环境变量
cp apps/server/.env.example apps/server/.env

# 编辑 .env 配置数据库连接

# 启动服务器
pnpm dev:server
```

服务器将运行在:
- HTTP API: http://localhost:3000
- WebSocket: ws://localhost:3001

#### 3. 启动桌面应用

```bash
pnpm dev:desktop
```

#### 4. 启动 MCP 服务器 (用于 IDE 集成)

```bash
cd packages/mcp-server
export GTEAM_TEAMS='[{"serverUrl":"http://localhost:3000","token":"your-jwt-token","teamName":"MyTeam"}]'
export GTEAM_DEFAULT_TEAM=MyTeam
pnpm dev
```

## 🔌 IDE 集成 (多团队)

### Cursor - 多团队配置

编辑 `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gteam": {
      "command": "node",
      "args": ["/path/to/gteam/packages/mcp-server/dist/cli.js"],
      "env": {
        "GTEAM_TEAMS": "[{\"serverUrl\":\"https://team1.com\",\"token\":\"token1\",\"teamName\":\"MyTeam\"},{\"serverUrl\":\"https://team2.com\",\"token\":\"token2\",\"teamName\":\"ClientTeam\"}]",
        "GTEAM_DEFAULT_TEAM": "MyTeam"
      }
    }
  }
}
```

### 配置说明

- `GTEAM_TEAMS`: JSON 数组，包含所有团队配置
  - `serverUrl`: 团队服务器 URL
  - `token`: 该服务器的 JWT token
  - `teamName`: 团队名称（用于识别）
- `GTEAM_DEFAULT_TEAM`: 默认团队（可选）

### Claude Desktop / Claude Code

编辑 `~/.config/claude/mcp.json` 或 `~/.claude.json` (使用相同配置)

### VS Code Copilot / Windsurf

参考各 IDE 的 MCP 配置文档。

### 可用 MCP 工具 (多团队感知)

所有工具接受可选的 `team` 参数（serverUrl 或 teamName），不提供则使用默认团队：

- `list_teams` - 列出所有已连接的团队 🆕
- `list_projects` - 列出项目 (参数: `team?`)
- `get_project_context` - 获取项目完整上下文 (参数: `projectId`, `team?`)
- `search_docs` - 搜索文档 (参数: `projectId`, `query`, `team?`)
- `read_doc` - 读取文档 (参数: `documentId`, `team?`)
- `write_doc` - 创建/更新文档 (参数: `projectId`, `title`, `content`, `partition`, `team?`)
- `list_requirements` - 列出需求 (参数: `projectId`, `team?`)
- `get_requirement` - 获取需求详情 (参数: `requirementId`, `team?`)
- `post_issue` - AI 报告问题 (参数: `projectId`, `title`, `description`, `team?`)
- `list_issues` - 列出问题 (参数: `projectId`, `team?`)
- `reply_issue` - 回复问题 (参数: `issueId`, `content`, `team?`)
- `get_git_progress` - 获取 Git 进度 (参数: `requirementId`, `team?`)

**使用示例**:

```typescript
// 查看所有团队
await mcp.callTool('list_teams', {});

// 从特定团队读取文档
await mcp.callTool('read_doc', { documentId: 'doc-123', team: 'MyTeam' });

// 使用默认团队
await mcp.callTool('list_projects', {});
```

## 🐳 部署团队服务器

### 使用 Docker Compose (推荐)

每个团队部署一个服务器实例：

```bash
# 设置 JWT 密钥
export JWT_SECRET=your-secret-key

# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

服务将在以下端口运行:
- API: http://localhost:3000
- WebSocket: ws://localhost:3001
- PostgreSQL: localhost:5432

### 生产部署建议

1. **域名和 HTTPS**: 配置域名和 SSL 证书（如 Caddy / Nginx）
2. **数据备份**: 定期备份 PostgreSQL 数据库
3. **环境变量**: 更改默认的 JWT_SECRET
4. **防火墙**: 限制数据库端口仅内网访问
5. **监控**: 配置日志和性能监控

### 邀请成员

部署后，管理员可生成邀请链接：

```bash
# 生成邀请码
curl -X POST https://your-team-server.com/api/auth/create-invite \
  -H "Authorization: Bearer admin-token" \
  -H "Content-Type: application/json" \
  -d '{"maxUses": 10, "expiresInDays": 7}'

# 分享邀请链接给团队成员
# gteam://your-team-server.com?invite=abc123xyz
```

### 手动部署

1. 构建生产版本:

```bash
pnpm build
```

2. 配置环境变量 (参考 `apps/server/.env.example`)

3. 运行数据库迁移:

```bash
cd apps/server
pnpm db:migrate
```

4. 启动服务器:

```bash
pnpm start
```

## 🧪 测试

```bash
# 运行所有测试
pnpm test

# 运行类型检查
pnpm typecheck

# 运行 lint
pnpm lint
```

## 📦 构建桌面应用

```bash
cd apps/desktop

# macOS
pnpm tauri build

# Windows
pnpm tauri build

# Linux
pnpm tauri build
```

构建产物位于 `apps/desktop/src-tauri/target/release/bundle/`

## 🛠️ 技术栈

- **后端**: Node.js, Express, WebSocket, PostgreSQL
- **桌面应用**: Tauri 2, React, TypeScript, Zustand
- **MCP 服务器**: @modelcontextprotocol/sdk
- **构建工具**: pnpm workspaces, Vite, Cargo
- **CI/CD**: GitHub Actions

## 📚 文档

- [API 文档](./docs/API.md)
- [MCP 工具文档](./packages/mcp-server/README.md)
- [开发路线图](./docs/ROADMAP.md)
- [权限模型详解](./docs/PERMISSIONS.md)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!

## 📄 许可证 (License)

gteam 采用基于组件的双重许可证模型：

### Apache-2.0 组件

- **桌面应用** (`apps/desktop/`)
- **MCP 服务器** (`packages/mcp-server/`)
- **共享库** (`packages/shared/`)

这些组件使用 **Apache License 2.0** 许可。

### AGPL-3.0 组件

- **服务器** (`apps/server/`)

服务器组件使用 **GNU Affero General Public License v3.0 (AGPL-3.0-only)** 许可。

如果您需要服务器组件的商业许可证，请通过 [@ncwtf](https://github.com/ncwtf) 联系作者。

详细信息请参阅 [LICENSING.md](./LICENSING.md)。

### 商标声明

**gteam** 名称和标志是 Hunter (ncwtf) 的商标，不在上述许可证范围内。使用 gteam 名称和标志需要单独授权。
