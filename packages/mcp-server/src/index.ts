#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

/**
 * teamctx MCP Server - 多团队支持版本
 * 
 * 架构说明:
 * - 支持连接多个团队（每个团队独立服务器）
 * - 工具接受可选的 team 参数（serverUrl 或 teamName）
 * - 配置默认激活的团队
 * - 提供 list_teams 工具查看所有连接的团队
 */

interface TeamConfig {
  serverUrl: string;
  token: string;
  teamName?: string;
}

interface ServerConfig {
  teams: TeamConfig[];
  defaultTeam?: string; // serverUrl 或 teamName
}

class TeamCtxMCPServer {
  private server: Server;
  private config: ServerConfig;
  private apiClients: Map<string, AxiosInstance> = new Map();

  constructor(config: ServerConfig) {
    this.config = config;
    
    // 为每个团队创建 API 客户端
    config.teams.forEach((team) => {
      this.apiClients.set(team.serverUrl, axios.create({
        baseURL: team.serverUrl,
        headers: {
          'Authorization': `Bearer ${team.token}`,
          'Content-Type': 'application/json'
        }
      }));
    });

    this.server = new Server(
      {
        name: 'teamctx-multi',
        version: '0.2.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  private getApiClient(teamIdentifier?: string): { api: AxiosInstance; teamConfig: TeamConfig } {
    let serverUrl: string;

    if (!teamIdentifier) {
      // 使用默认团队
      const defaultTeam = this.config.teams.find(
        (t) => t.serverUrl === this.config.defaultTeam || t.teamName === this.config.defaultTeam
      ) || this.config.teams[0];
      
      if (!defaultTeam) {
        throw new Error('未配置任何团队');
      }
      serverUrl = defaultTeam.serverUrl;
    } else {
      // 查找指定的团队
      const team = this.config.teams.find(
        (t) => t.serverUrl === teamIdentifier || t.teamName === teamIdentifier
      );
      
      if (!team) {
        throw new Error(`未找到团队: ${teamIdentifier}`);
      }
      serverUrl = team.serverUrl;
    }

    const api = this.apiClients.get(serverUrl);
    const teamConfig = this.config.teams.find((t) => t.serverUrl === serverUrl)!;
    
    if (!api) {
      throw new Error(`团队 API 客户端未初始化: ${serverUrl}`);
    }

    return { api, teamConfig };
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.getTools()
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_teams':
            return await this.listTeams();
          
          case 'list_projects':
            return await this.listProjects(args as any);
          
          case 'get_project_context':
            return await this.getProjectContext(args as any);
          
          case 'search_docs':
            return await this.searchDocs(args as any);
          
          case 'read_doc':
            return await this.readDoc(args as any);
          
          case 'write_doc':
            return await this.writeDoc(args as any);
          
          case 'list_requirements':
            return await this.listRequirements(args as any);
          
          case 'get_requirement':
            return await this.getRequirement(args as any);
          
          case 'post_issue':
            return await this.postIssue(args as any);
          
          case 'list_issues':
            return await this.listIssues(args as any);
          
          case 'reply_issue':
            return await this.replyIssue(args as any);
          
          case 'get_git_progress':
            return await this.getGitProgress(args as any);
          
          default:
            throw new Error(`未知工具: ${name}`);
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `错误: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });
  }

  private getTools(): Tool[] {
    const teamParam = {
      team: {
        type: 'string',
        description: '团队标识（serverUrl 或 teamName），不提供则使用默认团队'
      }
    };

    return [
      {
        name: 'list_teams',
        description: '列出所有已连接的团队',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'list_projects',
        description: '列出指定团队的所有项目',
        inputSchema: {
          type: 'object',
          properties: teamParam,
          required: []
        }
      },
      {
        name: 'get_project_context',
        description: '获取项目的完整上下文信息',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: '项目 ID' },
            ...teamParam
          },
          required: ['projectId']
        }
      },
      {
        name: 'search_docs',
        description: '在项目文档中搜索关键词',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: '项目 ID' },
            query: { type: 'string', description: '搜索关键词' },
            partition: {
              type: 'string',
              enum: ['personal', 'shared', 'collaborative'],
              description: '文档分区'
            },
            ...teamParam
          },
          required: ['projectId', 'query']
        }
      },
      {
        name: 'read_doc',
        description: '读取指定文档内容',
        inputSchema: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: '文档 ID' },
            ...teamParam
          },
          required: ['documentId']
        }
      },
      {
        name: 'write_doc',
        description: '创建或更新文档 (尊重分区权限)',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: '项目 ID' },
            title: { type: 'string', description: '文档标题' },
            content: { type: 'string', description: '文档内容 (Markdown)' },
            partition: {
              type: 'string',
              enum: ['personal', 'shared', 'collaborative'],
              description: '文档分区'
            },
            metadata: {
              type: 'object',
              description: '文档元数据'
            },
            ...teamParam
          },
          required: ['projectId', 'title', 'content', 'partition']
        }
      },
      {
        name: 'list_requirements',
        description: '列出项目的需求列表',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: '项目 ID' },
            ...teamParam
          },
          required: ['projectId']
        }
      },
      {
        name: 'get_requirement',
        description: '获取需求详情，包括关联的 Git 分支',
        inputSchema: {
          type: 'object',
          properties: {
            requirementId: { type: 'string', description: '需求 ID' },
            ...teamParam
          },
          required: ['requirementId']
        }
      },
      {
        name: 'post_issue',
        description: 'AI 报告问题或向团队提问',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: '项目 ID' },
            requirementId: { type: 'string', description: '相关需求 ID (可选)' },
            title: { type: 'string', description: '问题标题' },
            description: { type: 'string', description: '问题描述' },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
              description: '优先级'
            },
            ...teamParam
          },
          required: ['projectId', 'title', 'description']
        }
      },
      {
        name: 'list_issues',
        description: '列出项目的问题列表',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: '项目 ID' },
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'resolved', 'closed'],
              description: '问题状态'
            },
            ...teamParam
          },
          required: ['projectId']
        }
      },
      {
        name: 'reply_issue',
        description: '回复问题',
        inputSchema: {
          type: 'object',
          properties: {
            issueId: { type: 'string', description: '问题 ID' },
            content: { type: 'string', description: '回复内容' },
            ...teamParam
          },
          required: ['issueId', 'content']
        }
      },
      {
        name: 'get_git_progress',
        description: '获取需求的 Git 进度',
        inputSchema: {
          type: 'object',
          properties: {
            requirementId: { type: 'string', description: '需求 ID' },
            ...teamParam
          },
          required: ['requirementId']
        }
      }
    ];
  }

  // ========== 工具实现 ==========

  private async listTeams() {
    const teams = this.config.teams.map((team) => ({
      serverUrl: team.serverUrl,
      teamName: team.teamName || 'Unknown',
      isDefault: team.serverUrl === this.config.defaultTeam || team.teamName === this.config.defaultTeam
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(teams, null, 2)
        }
      ]
    };
  }

  private async listProjects(args: { team?: string }) {
    const { api, teamConfig } = this.getApiClient(args.team);
    const response = await api.get('/api/projects');
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            team: teamConfig.teamName || teamConfig.serverUrl,
            projects: response.data.data
          }, null, 2)
        }
      ]
    };
  }

  private async getProjectContext(args: { projectId: string; team?: string }) {
    const { api, teamConfig } = this.getApiClient(args.team);
    
    const [project, docs, requirements] = await Promise.all([
      api.get(`/api/projects/${args.projectId}`),
      api.get(`/api/documents?projectId=${args.projectId}`),
      api.get(`/api/requirements?projectId=${args.projectId}`)
    ]);

    const context = {
      team: teamConfig.teamName || teamConfig.serverUrl,
      project: project.data.data,
      documents: docs.data.data,
      requirements: requirements.data.data
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(context, null, 2)
        }
      ]
    };
  }

  private async searchDocs(args: { projectId: string; query: string; partition?: string; team?: string }) {
    const { api } = this.getApiClient(args.team);
    const params = new URLSearchParams({ projectId: args.projectId });
    if (args.partition) {
      params.append('partition', args.partition);
    }

    const response = await api.get(`/api/documents?${params}`);
    const docs = response.data.data;

    const filtered = docs.filter((doc: any) => 
      doc.title.toLowerCase().includes(args.query.toLowerCase()) ||
      doc.content.toLowerCase().includes(args.query.toLowerCase())
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(filtered, null, 2)
        }
      ]
    };
  }

  private async readDoc(args: { documentId: string; team?: string }) {
    const { api } = this.getApiClient(args.team);
    const response = await api.get(`/api/documents/${args.documentId}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data.data, null, 2)
        }
      ]
    };
  }

  private async writeDoc(args: any) {
    const { api } = this.getApiClient(args.team);
    const response = await api.post('/api/documents', {
      projectId: args.projectId,
      title: args.title,
      content: args.content,
      partition: args.partition,
      metadata: args.metadata || {}
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data.data, null, 2)
        }
      ]
    };
  }

  private async listRequirements(args: { projectId: string; team?: string }) {
    const { api } = this.getApiClient(args.team);
    const response = await api.get(`/api/requirements?projectId=${args.projectId}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data.data, null, 2)
        }
      ]
    };
  }

  private async getRequirement(args: { requirementId: string; team?: string }) {
    const { api } = this.getApiClient(args.team);
    const response = await api.get(`/api/requirements/${args.requirementId}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data.data, null, 2)
        }
      ]
    };
  }

  private async postIssue(args: any) {
    const { api } = this.getApiClient(args.team);
    const response = await api.post('/api/issues', {
      projectId: args.projectId,
      requirementId: args.requirementId,
      title: args.title,
      description: args.description,
      priority: args.priority || 'medium',
      createdByAI: true
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data.data, null, 2)
        }
      ]
    };
  }

  private async listIssues(args: { projectId: string; status?: string; team?: string }) {
    const { api } = this.getApiClient(args.team);
    const params = new URLSearchParams({ projectId: args.projectId });
    if (args.status) {
      params.append('status', args.status);
    }

    const response = await api.get(`/api/issues?${params}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data.data, null, 2)
        }
      ]
    };
  }

  private async replyIssue(args: { issueId: string; content: string; team?: string }) {
    const { api } = this.getApiClient(args.team);
    const response = await api.post(`/api/issues/${args.issueId}/replies`, {
      content: args.content,
      createdByAI: true
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data.data, null, 2)
        }
      ]
    };
  }

  private async getGitProgress(args: { requirementId: string; team?: string }) {
    const { api } = this.getApiClient(args.team);
    const response = await api.get(`/api/git/progress/${args.requirementId}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data.data, null, 2)
        }
      ]
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('teamctx MCP Server (多团队) 运行中...');
  }
}

// 主函数
export async function main() {
  // 从环境变量读取配置
  const teamsConfig = process.env.TEAMCTX_TEAMS;
  
  if (!teamsConfig) {
    console.error('错误: 需要设置 TEAMCTX_TEAMS 环境变量');
    console.error('格式: [{"serverUrl":"https://team1.com","token":"xxx","teamName":"Team1"},...]');
    process.exit(1);
  }

  let config: ServerConfig;
  try {
    const teams = JSON.parse(teamsConfig);
    config = {
      teams,
      defaultTeam: process.env.TEAMCTX_DEFAULT_TEAM || teams[0]?.serverUrl
    };
  } catch (error) {
    console.error('错误: TEAMCTX_TEAMS 配置格式不正确');
    process.exit(1);
  }

  const server = new TeamCtxMCPServer(config);
  await server.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('服务器错误:', error);
    process.exit(1);
  });
}
