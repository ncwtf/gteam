import { query } from '../db';
import requirementRoutes from './requirements';
import { authToken, jsonRequest, withTestServer } from '../test/http';
import { PROJECT_ID, REQUIREMENT_ID, TEAM_ID, USER_ID } from '../test/ids';

jest.mock('../db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('需求路由', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('不带可选仓库地址也能创建，并返回 camelCase', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_admin: false }] } as any)
      .mockResolvedValueOnce({
        rows: [{
          id: REQUIREMENT_ID,
          project_id: PROJECT_ID,
          title: '登录',
          description: '支持邮箱登录',
          git_branch: 'feature/login',
          git_repo_url: null,
          assignee_id: null,
          status: 'pending',
          created_by: USER_ID,
          created_at: new Date('2026-03-01T00:00:00.000Z'),
          updated_at: new Date('2026-03-01T00:00:00.000Z')
        }]
      } as any)
      .mockResolvedValueOnce({ rows: [{ team_id: TEAM_ID }] } as any);

    await withTestServer(
      (app) => app.use('/api/requirements', requirementRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/requirements', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` },
          body: JSON.stringify({
            projectId: PROJECT_ID,
            title: '登录',
            description: '支持邮箱登录',
            gitBranch: 'feature/login'
          })
        });

        expect(status).toBe(200);
        expect(body.data).toMatchObject({
          id: REQUIREMENT_ID,
          projectId: PROJECT_ID,
          gitBranch: 'feature/login',
          gitRepoUrl: null,
          assigneeId: null,
          status: 'pending',
          createdBy: USER_ID
        });
        expect(body.data.git_branch).toBeUndefined();
        expect(mockQuery.mock.calls[1][1]).toEqual([
          PROJECT_ID,
          '登录',
          '支持邮箱登录',
          'feature/login',
          null,
          null,
          USER_ID
        ]);
      }
    );
  });

  it('非项目成员不能创建需求', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await withTestServer(
      (app) => app.use('/api/requirements', requirementRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/requirements', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` },
          body: JSON.stringify({
            projectId: PROJECT_ID,
            title: '登录',
            description: '说明',
            gitBranch: 'feature/login'
          })
        });
        expect(status).toBe(403);
        expect(body.error).toContain('成员');
      }
    );
  });

  it('项目 ID 非法时返回 400', async () => {
    await withTestServer(
      (app) => app.use('/api/requirements', requirementRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/requirements?projectId=not-a-uuid', {
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` }
        });
        expect(status).toBe(400);
        expect(body.error).toBe('项目 ID 无效');
        expect(mockQuery).not.toHaveBeenCalled();
      }
    );
  });
});
