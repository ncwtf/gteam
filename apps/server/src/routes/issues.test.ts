import { query } from '../db';
import issueRoutes from './issues';
import { authToken, jsonRequest, withTestServer } from '../test/http';
import { ISSUE_ID, PROJECT_ID, TEAM_ID, USER_ID } from '../test/ids';

jest.mock('../db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('问题路由', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('不关联需求也能创建问题，可选外键写成 null', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_admin: false }] } as any)
      .mockResolvedValueOnce({
        rows: [{
          id: ISSUE_ID,
          project_id: PROJECT_ID,
          requirement_id: null,
          title: '按钮无响应',
          description: '点击新建项目没有对话框',
          priority: 'high',
          status: 'open',
          created_by: USER_ID,
          assigned_to: null,
          created_by_ai: false,
          created_at: new Date('2026-04-01T00:00:00.000Z'),
          updated_at: new Date('2026-04-01T00:00:00.000Z')
        }]
      } as any)
      .mockResolvedValueOnce({ rows: [{ team_id: TEAM_ID }] } as any);

    await withTestServer(
      (app) => app.use('/api/issues', issueRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/issues', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` },
          body: JSON.stringify({
            projectId: PROJECT_ID,
            title: '按钮无响应',
            description: '点击新建项目没有对话框',
            priority: 'high',
            createdByAI: false
          })
        });

        expect(status).toBe(200);
        expect(body.data).toMatchObject({
          id: ISSUE_ID,
          projectId: PROJECT_ID,
          requirementId: null,
          priority: 'high',
          createdBy: USER_ID,
          createdByAI: false
        });
        expect(body.data.created_by_ai).toBeUndefined();
        expect(mockQuery.mock.calls[1][1]).toEqual([
          PROJECT_ID,
          null,
          '按钮无响应',
          '点击新建项目没有对话框',
          'high',
          USER_ID,
          false
        ]);
      }
    );
  });

  it('未登录不能创建问题', async () => {
    await withTestServer(
      (app) => app.use('/api/issues', issueRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/issues', {
          method: 'POST',
          body: JSON.stringify({
            projectId: PROJECT_ID,
            title: '标题',
            description: '描述'
          })
        });
        expect(status).toBe(401);
        expect(body.error).toBe('未提供认证令牌');
      }
    );
  });
});
