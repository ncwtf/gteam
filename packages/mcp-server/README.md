# gteam (God Team) MCP Server - 多团队版本

为 AI IDE 提供团队上下文访问能力的 MCP 服务器，**支持同时连接多个团队**。

## 安装

```bash
pnpm install
pnpm build
```

## 使用

### 多团队配置

MCP 服务器现在支持同时连接多个团队（每个团队独立服务器）。

#### Cursor 配置示例

编辑 `~/.cursor/mcp.json`。从源码运行时可以手写；安装版桌面客户端会在「设置 → IDE 连接」里写入随应用打包的 MCP 程序，不需要本机安装 Node.js。

```json
{
  "mcpServers": {
    "gteam": {
      "command": "node",
      "args": ["/path/to/gteam/packages/mcp-server/dist/cli.js"],
      "env": {
        "GTEAM_TEAMS": "[{\"serverUrl\":\"https://team1.com\",\"token\":\"token1\",\"teamName\":\"Team1\"},{\"serverUrl\":\"https://team2.com\",\"token\":\"token2\",\"teamName\":\"Team2\"}]",
        "GTEAM_DEFAULT_TEAM": "Team1"
      }
    }
  }
}
```

#### 配置说明

- `GTEAM_TEAMS`: JSON 数组，包含所有团队配置
  - `serverUrl`: 团队服务器 URL
  - `token`: 该服务器的 JWT token
  - `teamName`: 团队名称（可选，用于识别）
  
- `GTEAM_DEFAULT_TEAM`: 默认团队（可选，serverUrl 或 teamName）

### Claude Desktop 配置

编辑 `~/.config/claude/mcp.json` (使用相同配置格式)

### VS Code / Windsurf 配置

参考各 IDE 的 MCP 配置文档。

## 可用工具

### 团队管理

- **`list_teams`** - 列出所有已连接的团队

### 项目和文档

所有工具现在都接受可选的 `team` 参数（serverUrl 或 teamName），不提供则使用默认团队。

- **`list_projects`** - 列出指定团队的所有项目
  - 参数: `team?` (可选)
  
- **`get_project_context`** - 获取项目完整上下文
  - 参数: `projectId`, `team?`
  
- **`search_docs`** - 搜索文档
  - 参数: `projectId`, `query`, `partition?`, `team?`
  
- **`read_doc`** - 读取文档
  - 参数: `documentId`, `team?`
  
- **`write_doc`** - 创建/更新文档 (尊重权限)
  - 参数: `projectId`, `title`, `content`, `partition`, `metadata?`, `team?`

### 需求管理

- **`list_requirements`** - 列出需求
  - 参数: `projectId`, `team?`
  
- **`get_requirement`** - 获取需求详情
  - 参数: `requirementId`, `team?`

### 问题协作

- **`post_issue`** - AI 报告问题
  - 参数: `projectId`, `title`, `description`, `priority?`, `requirementId?`, `team?`
  
- **`list_issues`** - 列出问题
  - 参数: `projectId`, `status?`, `team?`
  
- **`reply_issue`** - 回复问题
  - 参数: `issueId`, `content`, `team?`

### Git 进度

- **`get_git_progress`** - 获取 Git 进度
  - 参数: `requirementId`, `team?`

## 使用示例

### 查看所有团队

```typescript
await mcp.callTool('list_teams', {});
// 返回: [
//   { serverUrl: "https://team1.com", teamName: "Team1", isDefault: true },
//   { serverUrl: "https://team2.com", teamName: "Team2", isDefault: false }
// ]
```

### 跨团队操作

```typescript
// 从 Team1 读取文档
await mcp.callTool('read_doc', {
  documentId: 'doc-123',
  team: 'Team1'
});

// 从 Team2 列出项目
await mcp.callTool('list_projects', {
  team: 'Team2'
});

// 使用默认团队（不指定 team 参数）
await mcp.callTool('list_projects', {});
```

## 架构说明

- **去中心化**: 每个团队自托管独立的服务器
- **多团队并存**: 一个 MCP 服务器实例可连接多个团队
- **数据隔离**: 不同团队的数据完全隔离
- **灵活切换**: 通过 `team` 参数随时切换目标团队
- **默认团队**: 支持配置默认团队，简化常用操作

## 安全存储

**重要**: Token 应该安全存储，建议使用：

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service API / gnome-keyring

桌面应用已集成安全存储（Tauri），MCP 配置暂时使用环境变量。
