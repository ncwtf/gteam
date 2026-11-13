import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from '../db';
import { setupRoutes } from './index';

jest.mock('../db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}));

jest.mock('../websocket', () => ({
  broadcastEvent: jest.fn(),
  setupWebSocket: jest.fn()
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

const USER = 'user-1';
const TEAM = '22222222-2222-4222-8222-222222222222';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const DOC = '33333333-3333-4333-8333-333333333333';
const REQ = '44444444-4444-4444-8444-444444444444';
const ISSUE = '55555555-5555-4555-8555-555555555555';

const token = jwt.sign(
  { userId: USER, email: 'owner@example.com' },
  'dev-secret-change-in-production'
);

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT,
    team_id: TEAM,
    name: 'Alpha',
    description: '描述',
    git_repo_url: 'https://example.com/repo.git',
    linked_project_ids: null,
    created_at: new Date('2024-01-01T00:00:00.000Z'),
    updated_at: new Date('2024-01-02T00:00:00.000Z'),
    ...overrides
  };
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC,
    project_id: PROJECT,
    title: '设计文档',
    content: '正文',
    partition: 'collaborative',
    owner_id: USER,
    metadata: { tags: ['api'] },
    created_at: new Date('2024-01-03T00:00:00.000Z'),
    updated_at: new Date('2024-01-04T00:00:00.000Z'),
    team_id: TEAM,
    ...overrides
  };
}

function requirementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ,
    project_id: PROJECT,
    title: '登录',
    description: '实现登录',
    git_branch: 'feature/login',
    git_repo_url: null,
    assignee_id: null,
    status: 'pending',
    created_by: USER,
    created_at: new Date('2024-02-01T00:00:00.000Z'),
    updated_at: new Date('2024-02-02T00:00:00.000Z'),
    ...overrides
  };
}

function issueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ISSUE,
    project_id: PROJECT,
    requirement_id: null,
    title: '按钮无响应',
    description: '点击没有反应',
    priority: 'high',
    status: 'open',
    created_by: USER,
    assigned_to: null,
    created_by_ai: false,
    created_at: new Date('2024-03-01T00:00:00.000Z'),
    updated_at: new Date('2024-03-02T00:00:00.000Z'),
    ...overrides
  };
}

interface Scenario {
  admin?: boolean;
  member?: boolean;
  project?: Record<string, unknown> | null;
  document?: Record<string, unknown> | null;
  requirement?: Record<string, unknown> | null;
  issue?: Record<string, unknown> | null;
  projects?: Record<string, unknown>[];
  replies?: Record<string, unknown>[];
  invite?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
  team?: Record<string, unknown> | null;
}

let scenario: Scenario = {};

function installScenario(next: Scenario = {}) {
  scenario = {
    admin: true,
    member: true,
    project: projectRow(),
    document: documentRow(),
    requirement: requirementRow(),
    issue: issueRow(),
    projects: [projectRow()],
    replies: [],
    ...next
  };

  mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('SELECT is_admin FROM team_members')) {
      return { rows: scenario.admin ? [{ is_admin: true }] : [] } as any;
    }
    if (text.includes('SELECT p.*, tm.is_admin')) {
      if (scenario.member === false || scenario.project == null) return { rows: [] } as any;
      return { rows: [{ ...scenario.project, is_admin: Boolean(scenario.admin) }] } as any;
    }
    if (text.includes('SELECT DISTINCT p.*')) {
      return { rows: scenario.projects || [] } as any;
    }
    if (text.includes('INSERT INTO projects')) {
      return {
        rows: [projectRow({
          team_id: params?.[0],
          name: params?.[1],
          description: params?.[2],
          git_repo_url: params?.[3]
        })]
      } as any;
    }
    if (text.includes('UPDATE projects SET')) {
      return { rows: [projectRow({ name: params?.[0], description: params?.[1], git_repo_url: params?.[2] })] } as any;
    }
    if (text.includes('DELETE FROM projects')) {
      return { rows: scenario.project ? [scenario.project] : [] } as any;
    }
    if (text.includes('SELECT * FROM projects WHERE id')) {
      return { rows: scenario.project ? [scenario.project] : [] } as any;
    }
    if (text.includes('SELECT team_id FROM projects')) {
      return { rows: [{ team_id: TEAM }] } as any;
    }

    if (text.includes('SELECT DISTINCT d.*')) {
      return { rows: scenario.document ? [scenario.document] : [] } as any;
    }
    if (text.includes('FROM documents d')) {
      return { rows: scenario.document ? [scenario.document] : [] } as any;
    }
    if (text.includes('FROM team_members WHERE team_id')) {
      if (scenario.member === false) return { rows: [] } as any;
      return { rows: [{ user_id: USER, is_admin: Boolean(scenario.admin), role: '管理员' }] } as any;
    }
    if (text.includes('SELECT * FROM documents WHERE id')) {
      return { rows: scenario.document ? [scenario.document] : [] } as any;
    }
    if (text.includes('INSERT INTO documents')) {
      return { rows: [documentRow({ title: params?.[1], content: params?.[2], partition: params?.[3] })] } as any;
    }
    if (text.includes('UPDATE documents SET')) {
      return { rows: [documentRow({ title: params?.[0] })] } as any;
    }
    if (text.includes('DELETE FROM documents')) {
      return { rows: scenario.document ? [{ project_id: PROJECT }] : [] } as any;
    }

    if (text.includes('SELECT DISTINCT r.*')) {
      return { rows: scenario.requirement ? [scenario.requirement] : [] } as any;
    }
    if (text.includes('FROM requirements r')) {
      if (scenario.member === false || !scenario.requirement) return { rows: [] } as any;
      return { rows: [{ ...scenario.requirement, is_admin: Boolean(scenario.admin) }] } as any;
    }
    if (text.includes('SELECT * FROM requirements WHERE id')) {
      return { rows: scenario.requirement ? [scenario.requirement] : [] } as any;
    }
    if (text.includes('INSERT INTO requirements')) {
      return { rows: [requirementRow({ title: params?.[1], git_branch: params?.[3] })] } as any;
    }
    if (text.includes('UPDATE requirements SET')) {
      return { rows: [requirementRow({ title: params?.[0], status: text.includes('status') ? params?.[0] : 'pending' })] } as any;
    }
    if (text.includes('DELETE FROM requirements')) {
      return { rows: scenario.requirement ? [{ project_id: PROJECT, title: scenario.requirement.title }] : [] } as any;
    }

    if (text.includes('SELECT DISTINCT i.*')) {
      return { rows: scenario.issue ? [scenario.issue] : [] } as any;
    }
    if (text.includes('FROM issues i')) {
      if (scenario.member === false || !scenario.issue) return { rows: [] } as any;
      return { rows: [{ ...scenario.issue, is_admin: Boolean(scenario.admin) }] } as any;
    }
    if (text.includes('SELECT * FROM issues WHERE id')) {
      return { rows: scenario.issue ? [scenario.issue] : [] } as any;
    }
    if (text.includes('SELECT project_id FROM issues')) {
      return { rows: [{ project_id: PROJECT }] } as any;
    }
    if (text.includes('UPDATE issues SET')) {
      return { rows: [issueRow({ status: params?.[0] })] } as any;
    }
    if (text.includes('DELETE FROM issues')) {
      return { rows: scenario.issue ? [{ project_id: PROJECT, title: scenario.issue.title }] : [] } as any;
    }
    if (text.includes('FROM issue_replies')) {
      return { rows: scenario.replies || [] } as any;
    }
    if (text.includes('INSERT INTO issue_replies')) {
      return {
        rows: [{
          id: '66666666-6666-4666-8666-666666666666',
          issue_id: params?.[0],
          user_id: params?.[1],
          content: params?.[2],
          created_by_ai: params?.[3],
          created_at: new Date('2024-03-03T00:00:00.000Z')
        }]
      } as any;
    }

    if (text.includes('FROM invites WHERE code')) {
      return { rows: scenario.invite ? [scenario.invite] : [] } as any;
    }
    if (text.includes('FROM users WHERE email')) {
      return { rows: scenario.user ? [scenario.user] : [] } as any;
    }
    if (text.includes('FROM team_members WHERE team_id = $1 AND user_id = $2') && text.includes('SELECT *')) {
      if (scenario.member === false) return { rows: [] } as any;
      return { rows: [{ is_admin: Boolean(scenario.admin), user_id: USER }] } as any;
    }
    if (text.includes('tm.is_admin, tm.role')) {
      return { rows: scenario.team ? [scenario.team] : [] } as any;
    }
    if (text.includes('SELECT name FROM teams')) {
      return { rows: [{ name: 'God Team' }] } as any;
    }

    throw new Error(`未模拟的 SQL: ${text}`);
  });
}

async function call(method: string, path: string, body?: unknown, auth?: string) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const url = new URL(path, baseUrl);
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...(auth ? { Authorization: `Bearer ${auth}` } : {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: any = {};
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = { raw: text };
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let baseUrl = '';
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  setupRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试服务器没有端口');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

beforeEach(() => {
  mockQuery.mockReset();
  installScenario();
});

describe('项目路由', () => {
  it('未登录不能列出项目', async () => {
    const res = await call('GET', '/api/projects');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('缺少名称时拒绝创建', async () => {
    const res = await call('POST', '/api/projects', { teamId: TEAM }, token);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('缺少');
  });

  it('非管理员不能创建项目', async () => {
    installScenario({ admin: false });
    const res = await call('POST', '/api/projects', { teamId: TEAM, name: '新项目' }, token);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('管理员');
    expect(mockQuery.mock.calls.some((item) => String(item[0]).includes('INSERT INTO projects'))).toBe(false);
  });

  it('管理员创建项目并返回驼峰字段', async () => {
    const res = await call('POST', '/api/projects', {
      teamId: TEAM,
      name: ' 新项目 ',
      description: '说明',
      gitRepoUrl: 'https://example.com/repo.git'
    }, token);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      teamId: TEAM,
      name: '新项目',
      description: '说明',
      gitRepoUrl: 'https://example.com/repo.git'
    });
    expect(res.body.data.team_id).toBeUndefined();
    expect(res.body.data.git_repo_url).toBeUndefined();
  });

  it('项目列表使用驼峰字段', async () => {
    const res = await call('GET', '/api/projects', undefined, token);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      id: PROJECT,
      teamId: TEAM,
      gitRepoUrl: 'https://example.com/repo.git',
      createdAt: '2024-01-01T00:00:00.000Z'
    });
    expect(res.body.data[0].team_id).toBeUndefined();
  });

  it('可以更新和删除项目', async () => {
    const updated = await call('PUT', `/api/projects/${PROJECT}`, {
      name: '改名',
      description: '新描述',
      gitRepoUrl: 'https://example.com/new.git'
    }, token);
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      id: PROJECT,
      teamId: TEAM,
      name: '改名',
      gitRepoUrl: 'https://example.com/new.git'
    });

    const removed = await call('DELETE', `/api/projects/${PROJECT}`, undefined, token);
    expect(removed.status).toBe(200);
    expect(removed.body.message).toContain('删除');
  });

  it('非管理员不能修改项目', async () => {
    installScenario({ admin: false });
    const res = await call('PUT', `/api/projects/${PROJECT}`, { name: '改名' }, token);
    expect(res.status).toBe(403);
  });
});

describe('文档、需求和问题路由', () => {
  it('可以读取文档详情（驼峰字段）', async () => {
    const res = await call('GET', `/api/documents/${DOC}`, undefined, token);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: DOC,
      projectId: PROJECT,
      title: '设计文档',
      ownerId: USER,
      partition: 'collaborative'
    });
    expect(res.body.data.project_id).toBeUndefined();
    expect(res.body.data.updatedAt).toBe('2024-01-04T00:00:00.000Z');
  });

  it('非成员不能读取文档', async () => {
    installScenario({ member: false });
    const res = await call('GET', `/api/documents/${DOC}`, undefined, token);
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
  });

  it('可以读取、更新和删除需求', async () => {
    const detail = await call('GET', `/api/requirements/${REQ}`, undefined, token);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      id: REQ,
      projectId: PROJECT,
      gitBranch: 'feature/login',
      status: 'pending'
    });
    expect(detail.body.data.git_branch).toBeUndefined();

    const updated = await call('PUT', `/api/requirements/${REQ}`, {
      title: '登录改造',
      description: '补充错误提示',
      gitBranch: 'feature/login-errors',
      status: 'in_progress'
    }, token);
    expect(updated.status).toBe(200);
    expect(updated.body.data.projectId).toBe(PROJECT);

    const badStatus = await call('PATCH', `/api/requirements/${REQ}/status`, { status: 'nope' }, token);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toContain('状态');

    const removed = await call('DELETE', `/api/requirements/${REQ}`, undefined, token);
    expect(removed.status).toBe(200);
  });

  it('可以读取、改状态和删除问题，回复使用驼峰字段', async () => {
    const detail = await call('GET', `/api/issues/${ISSUE}`, undefined, token);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      id: ISSUE,
      projectId: PROJECT,
      createdByAI: false,
      priority: 'high',
      createdAt: '2024-03-01T00:00:00.000Z'
    });
    expect(detail.body.data.created_by_ai).toBeUndefined();

    const status = await call('PATCH', `/api/issues/${ISSUE}/status`, { status: 'resolved' }, token);
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('resolved');

    installScenario({
      replies: [{
        id: '66666666-6666-4666-8666-666666666666',
        issue_id: ISSUE,
        user_id: USER,
        content: '已经复现',
        created_by_ai: false,
        created_at: new Date('2024-03-03T00:00:00.000Z')
      }]
    });
    const replies = await call('GET', `/api/issues/${ISSUE}/replies`, undefined, token);
    expect(replies.status).toBe(200);
    expect(replies.body.data[0]).toMatchObject({
      issueId: ISSUE,
      userId: USER,
      content: '已经复现',
      createdByAI: false
    });

    const removed = await call('DELETE', `/api/issues/${ISSUE}`, undefined, token);
    expect(removed.status).toBe(200);
  });

  it('无效的资源 ID 返回 400 而不是 500', async () => {
    const res = await call('GET', '/api/documents/not-a-uuid', undefined, token);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('无效');
  });
});

describe('团队信息与邀请', () => {
  it('团队信息返回驼峰字段和管理员标记', async () => {
    installScenario({
      team: {
        id: TEAM,
        organization_id: null,
        name: 'God Team',
        description: null,
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-01T00:00:00.000Z'),
        is_admin: true,
        role: '管理员'
      }
    });
    const res = await call('GET', '/api/auth/team-info', undefined, token);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: TEAM,
      name: 'God Team',
      isAdmin: true,
      role: '管理员'
    });
    expect(res.body.data.organization_id).toBeUndefined();
    expect(res.body.data.is_admin).toBeUndefined();
  });

  it('新用户使用过短密码加入邀请会被拒绝', async () => {
    installScenario({
      invite: {
        id: '77777777-7777-4777-8777-777777777777',
        team_id: TEAM,
        code: 'abc',
        expires_at: null,
        max_uses: null,
        current_uses: 0
      },
      user: null
    });
    const res = await call('POST', '/api/auth/join-invite', {
      inviteCode: 'abc',
      email: 'new@example.com',
      password: 'short'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('8');
    expect(mockQuery.mock.calls.some((item) => String(item[0]).includes('INSERT INTO users'))).toBe(false);
  });

  it('已经在团队中的成员再次使用邀请码不会消耗次数', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    installScenario({
      invite: {
        id: '77777777-7777-4777-8777-777777777777',
        team_id: TEAM,
        code: 'abc',
        expires_at: null,
        max_uses: 1,
        current_uses: 0
      },
      user: {
        id: USER,
        email: 'owner@example.com',
        name: 'Owner',
        password_hash: passwordHash,
        created_at: new Date('2024-01-01T00:00:00.000Z')
      },
      admin: true,
      member: true
    });
    const res = await call('POST', '/api/auth/join-invite', {
      inviteCode: 'abc',
      email: 'owner@example.com',
      password: 'password123'
    });
    expect(res.status).toBe(200);
    expect(res.body.data.teamId).toBe(TEAM);
    expect(res.body.data.isAdmin).toBe(true);
    expect(res.body.data.user.password_hash).toBeUndefined();
    expect(mockQuery.mock.calls.some((item) => String(item[0]).includes('UPDATE invites'))).toBe(false);
  });
});
