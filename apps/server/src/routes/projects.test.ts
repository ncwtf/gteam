import { query } from '../db';
import projectRoutes from './projects';
import { authToken, jsonRequest, withTestServer } from '../test/http';
import { PROJECT_ID, TEAM_ID, USER_ID } from '../test/ids';

jest.mock('../db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

const projectRow = {
  id: PROJECT_ID,
  team_id: TEAM_ID,
  name: '客户端',
  description: null,
  git_repo_url: null,
  linked_project_ids: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z')
};

describe('项目路由', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('未登录时拒绝访问', async () => {
    await withTestServer(
      (app) => app.use('/api/projects', projectRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/projects');
        expect(status).toBe(401);
        expect(body).toEqual({ success: false, error: '未提供认证令牌' });
        expect(mockQuery).not.toHaveBeenCalled();
      }
    );
  });

  it('只按当前用户查询项目，并返回 camelCase', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [projectRow] } as any);

    await withTestServer(
      (app) => app.use('/api/projects', projectRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/projects', {
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` }
        });
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data).toEqual([
          {
            id: PROJECT_ID,
            teamId: TEAM_ID,
            name: '客户端',
            description: null,
            gitRepoUrl: null,
            linkedProjectIds: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z'
          }
        ]);
        expect(body.data[0].team_id).toBeUndefined();
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('tm.user_id = $1'), [USER_ID]);
      }
    );
  });

  it('缺少名称时不写数据库', async () => {
    await withTestServer(
      (app) => app.use('/api/projects', projectRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/projects', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` },
          body: JSON.stringify({ teamId: TEAM_ID, name: '   ' })
        });
        expect(status).toBe(400);
        expect(body.error).toBe('请填写团队和项目名称');
        expect(mockQuery).not.toHaveBeenCalled();
      }
    );
  });

  it('非团队成员不能创建项目', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await withTestServer(
      (app) => app.use('/api/projects', projectRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/projects', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` },
          body: JSON.stringify({ teamId: TEAM_ID, name: '客户端' })
        });
        expect(status).toBe(403);
        expect(body.error).toBe('你不是该团队的成员，无法创建项目');
        expect(mockQuery).toHaveBeenCalledTimes(1);
      }
    );
  });

  it('普通成员不能创建项目', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: false }] } as any);

    await withTestServer(
      (app) => app.use('/api/projects', projectRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/projects', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` },
          body: JSON.stringify({ teamId: TEAM_ID, name: '客户端' })
        });
        expect(status).toBe(403);
        expect(body.error).toBe('需要管理员权限才能创建项目');
      }
    );
  });

  it('管理员可以创建项目，可选字段写成 null', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_admin: true }] } as any)
      .mockResolvedValueOnce({ rows: [{ ...projectRow, name: '客户端' }] } as any);

    await withTestServer(
      (app) => app.use('/api/projects', projectRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/projects', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` },
          body: JSON.stringify({ teamId: TEAM_ID, name: ' 客户端 ' })
        });
        expect(status).toBe(200);
        expect(body.data).toMatchObject({
          id: PROJECT_ID,
          teamId: TEAM_ID,
          name: '客户端',
          gitRepoUrl: null
        });
        expect(mockQuery).toHaveBeenNthCalledWith(
          1,
          'SELECT is_admin FROM team_members WHERE team_id = $1 AND user_id = $2',
          [TEAM_ID, USER_ID]
        );
        expect(mockQuery).toHaveBeenNthCalledWith(
          2,
          'INSERT INTO projects (team_id, name, description, git_repo_url) VALUES ($1, $2, $3, $4) RETURNING *',
          [TEAM_ID, '客户端', null, null]
        );
      }
    );
  });

  it('非成员不能读取项目详情', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await withTestServer(
      (app) => app.use('/api/projects', projectRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, `/api/projects/${PROJECT_ID}`, {
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` }
        });
        expect(status).toBe(403);
        expect(body.success).toBe(false);
      }
    );
  });
});
