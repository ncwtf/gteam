import { query } from '../db';
import authRoutes from './auth';
import { authToken, jsonRequest, withTestServer } from '../test/http';
import { TEAM_ID, USER_ID } from '../test/ids';

jest.mock('../db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('认证路由', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('未登录不能读取团队信息', async () => {
    await withTestServer(
      (app) => app.use('/api/auth', authRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/auth/team-info');
        expect(status).toBe(401);
        expect(body.error).toBe('未提供认证令牌');
        expect(mockQuery).not.toHaveBeenCalled();
      }
    );
  });

  it('团队信息返回 camelCase 和管理员标记', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: TEAM_ID,
        organization_id: null,
        name: 'God Team',
        description: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-03T00:00:00.000Z'),
        is_admin: true
      }]
    } as any);

    await withTestServer(
      (app) => app.use('/api/auth', authRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/auth/team-info', {
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` }
        });
        expect(status).toBe(200);
        expect(body.data).toMatchObject({
          id: TEAM_ID,
          name: 'God Team',
          organizationId: null,
          isAdmin: true
        });
        expect(body.data.organization_id).toBeUndefined();
        expect(body.data.is_admin).toBeUndefined();
        expect(mockQuery.mock.calls[0][1]).toEqual([USER_ID]);
      }
    );
  });

  it('没有团队时返回中文错误', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await withTestServer(
      (app) => app.use('/api/auth', authRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/auth/team-info', {
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` }
        });
        expect(status).toBe(404);
        expect(body.error).toBe('未找到团队');
      }
    );
  });

  it('邀请加入缺少字段时返回中文错误', async () => {
    await withTestServer(
      (app) => app.use('/api/auth', authRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/auth/join-invite', {
          method: 'POST',
          body: JSON.stringify({ email: 'a@example.com' })
        });
        expect(status).toBe(400);
        expect(body.error).toBe('缺少必要字段');
        expect(mockQuery).not.toHaveBeenCalled();
      }
    );
  });

  it('新用户用邀请码加入时密码至少 8 位', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'invite-1',
          team_id: TEAM_ID,
          expires_at: null,
          max_uses: null,
          current_uses: 0
        }]
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    await withTestServer(
      (app) => app.use('/api/auth', authRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/auth/join-invite', {
          method: 'POST',
          body: JSON.stringify({
            inviteCode: 'abc',
            email: 'new@example.com',
            password: 'short'
          })
        });
        expect(status).toBe(400);
        expect(body.error).toBe('密码至少 8 位');
        expect(mockQuery).toHaveBeenCalledTimes(2);
      }
    );
  });
});
