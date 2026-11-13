/**
 * IDE 配置生成器
 * 支持 Cursor, Claude Code, Codex, CodeBuddy 等
 */

import { TeamConnection } from '@gteam/shared';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';

export interface IDEConfig {
  name: string;
  configPath: string;
  generateConfig: (connections: TeamConnection[], mcpServerPath: string) => string;
  description: string;
}

/**
 * Cursor 配置
 * 路径: ~/.cursor/mcp.json
 */
export const cursorConfig: IDEConfig = {
  name: 'Cursor',
  configPath: '~/.cursor/mcp.json',
  description: 'Cursor IDE - MCP 配置',
  generateConfig: (connections, mcpServerPath) => {
    const teams = connections.map(conn => ({
      serverUrl: conn.serverUrl,
      token: conn.token,
      teamName: conn.teamName
    }));

    const config = {
      mcpServers: {
        gteam: {
          command: 'node',
          args: [mcpServerPath],
          env: {
            GTEAM_TEAMS: JSON.stringify(teams),
            GTEAM_DEFAULT_TEAM: connections[0]?.teamName || ''
          }
        }
      }
    };

    return JSON.stringify(config, null, 2);
  }
};

/**
 * Claude Desktop 配置
 * macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * Windows: %APPDATA%\Claude\claude_desktop_config.json
 * Linux: ~/.config/claude/config.json
 */
export const claudeConfig: IDEConfig = {
  name: 'Claude Desktop',
  configPath: 'platform-specific', // 会根据平台自动选择
  description: 'Claude Desktop - MCP 配置',
  generateConfig: (connections, mcpServerPath) => {
    const teams = connections.map(conn => ({
      serverUrl: conn.serverUrl,
      token: conn.token,
      teamName: conn.teamName
    }));

    const config = {
      mcpServers: {
        gteam: {
          command: 'node',
          args: [mcpServerPath],
          env: {
            GTEAM_TEAMS: JSON.stringify(teams),
            GTEAM_DEFAULT_TEAM: connections[0]?.teamName || ''
          }
        }
      }
    };

    return JSON.stringify(config, null, 2);
  }
};

/**
 * Claude Code 配置
 * 用户范围: ~/.claude.json (推荐) 或使用 `claude mcp add` 命令
 * 项目范围: 项目根目录 .mcp.json
 * 注意: 不是 ~/.claude/mcp.json
 */
export const claudeCodeConfig: IDEConfig = {
  name: 'Claude Code',
  configPath: '~/.claude.json',
  description: 'Claude Code CLI - 用户范围 MCP 配置',
  generateConfig: (connections, mcpServerPath) => {
    const teams = connections.map(conn => ({
      serverUrl: conn.serverUrl,
      token: conn.token,
      teamName: conn.teamName
    }));

    const config = {
      mcpServers: {
        gteam: {
          command: 'node',
          args: [mcpServerPath],
          env: {
            GTEAM_TEAMS: JSON.stringify(teams),
            GTEAM_DEFAULT_TEAM: connections[0]?.teamName || ''
          }
        }
      }
    };

    return JSON.stringify(config, null, 2);
  }
};

/**
 * Codex 配置
 * 路径: ~/.codex/config.toml
 * 格式: TOML [mcp_servers.*] 部分
 */
export const codexConfig: IDEConfig = {
  name: 'Codex',
  configPath: '~/.codex/config.toml',
  description: 'Codex - TOML 格式 MCP 配置',
  generateConfig: (connections, mcpServerPath) => {
    const teams = connections.map(conn => ({
      serverUrl: conn.serverUrl,
      token: conn.token,
      teamName: conn.teamName
    }));

    // Codex 使用 TOML 格式，[mcp_servers.*] 部分
    let toml = `[mcp_servers.gteam]\n`;
    toml += `command = "node"\n`;
    toml += `args = ["${mcpServerPath}"]\n\n`;
    toml += `[mcp_servers.gteam.env]\n`;
    toml += `GTEAM_TEAMS = '${JSON.stringify(teams)}'\n`;
    toml += `GTEAM_DEFAULT_TEAM = "${connections[0]?.teamName || ''}"\n`;

    return toml;
  }
};

/**
 * CodeBuddy 配置
 * 路径: ~/.codebuddy/mcp.json
 */
export const codeBuddyConfig: IDEConfig = {
  name: 'CodeBuddy',
  configPath: '~/.codebuddy/mcp.json',
  description: 'CodeBuddy - MCP 配置',
  generateConfig: (connections, mcpServerPath) => {
    const teams = connections.map(conn => ({
      serverUrl: conn.serverUrl,
      token: conn.token,
      teamName: conn.teamName
    }));

    const config = {
      mcpServers: {
        gteam: {
          command: 'node',
          args: [mcpServerPath],
          env: {
            GTEAM_TEAMS: JSON.stringify(teams),
            GTEAM_DEFAULT_TEAM: connections[0]?.teamName || ''
          }
        }
      }
    };

    return JSON.stringify(config, null, 2);
  }
};

/**
 * 所有支持的 IDE
 */
export const supportedIDEs: IDEConfig[] = [
  cursorConfig,
  claudeConfig,
  claudeCodeConfig,
  codexConfig,
  codeBuddyConfig
];

/**
 * 获取 MCP 服务器路径
 */
export async function getMCPServerPath(): Promise<string> {
  // 默认路径，实际应该从应用安装位置获取
  const home = await homeDir();
  return `${home}/gteam/packages/mcp-server/dist/cli.js`;
}

/**
 * 写入 IDE 配置文件
 */
export async function writeIDEConfig(
  ide: IDEConfig,
  connections: TeamConnection[]
): Promise<{ success: boolean; message: string }> {
  try {
    const mcpServerPath = await getMCPServerPath();
    const configContent = ide.generateConfig(connections, mcpServerPath);

    // 获取配置文件路径
    const home = await homeDir();
    let configPath = ide.configPath.replace('~', home);

    // Claude Desktop 需要根据平台选择路径
    if (ide.name === 'Claude Desktop') {
      const platform = await import('@tauri-apps/plugin-os').then(m => m.platform());
      if (platform === 'macos') {
        configPath = `${home}/Library/Application Support/Claude/claude_desktop_config.json`;
      } else if (platform === 'windows') {
        configPath = `${home}/AppData/Roaming/Claude/claude_desktop_config.json`;
      } else {
        configPath = `${home}/.config/claude/config.json`;
      }
    }

    // 这里简化处理，实际应该合并现有配置
    await writeTextFile(configPath, configContent);

    return {
      success: true,
      message: `${ide.name} 配置已写入: ${configPath}`
    };
  } catch (error: any) {
    return {
      success: false,
      message: `写入失败: ${error.message}`
    };
  }
}

/**
 * 复制配置到剪贴板
 */
export async function copyIDEConfigToClipboard(
  ide: IDEConfig,
  connections: TeamConnection[]
): Promise<void> {
  const mcpServerPath = await getMCPServerPath();
  const configContent = ide.generateConfig(connections, mcpServerPath);

  // 使用 Tauri 的剪贴板 API
  await navigator.clipboard.writeText(configContent);
}
