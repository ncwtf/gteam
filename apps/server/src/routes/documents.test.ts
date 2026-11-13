import { query } from '../db';
import documentRoutes from './documents';
import { authToken, jsonRequest, withTestServer } from '../test/http';
import { DOCUMENT_ID, PROJECT_ID, TEAM_ID, USER_ID } from '../test/ids';

jest.mock('../db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('文档路由', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('团队成员可以创建文档，响应使用 camelCase', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_admin: false }] } as any)
      .mockResolvedValueOnce({
        rows: [{
          id: DOCUMENT_ID,
          project_id: PROJECT_ID,
          title: '架构说明',
          content: '# 标题',
          partition: 'collaborative',
          owner_id: USER_ID,
          metadata: { projectId: PROJECT_ID, ownerId: USER_ID },
          created_at: new Date('2026-05-01T00:00:00.000Z'),
          updated_at: new Date('2026-05-01T00:00:00.000Z')
        }]
      } as any)
      .mockResolvedValueOnce({ rows: [{ team_id: TEAM_ID }] } as any);

    await withTestServer(
      (app) => app.use('/api/documents', documentRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/documents', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` },
          body: JSON.stringify({
            projectId: PROJECT_ID,
            title: '架构说明',
            content: '# 标题',
            partition: 'collaborative'
          })
        });

        expect(status).toBe(200);
        expect(body.data).toMatchObject({
          id: DOCUMENT_ID,
          projectId: PROJECT_ID,
          ownerId: USER_ID,
          partition: 'collaborative',
          title: '架构说明'
        });
        expect(body.data.project_id).toBeUndefined();
        expect(body.data.updatedAt).toBe('2026-05-01T00:00:00.000Z');
      }
    );
  });

  it('无效分区返回中文错误', async () => {
    await withTestServer(
      (app) => app.use('/api/documents', documentRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, '/api/documents', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` },
          body: JSON.stringify({
            projectId: PROJECT_ID,
            title: '架构说明',
            content: '正文',
            partition: 'public'
          })
        });
        expect(status).toBe(400);
        expect(body.error).toBe('无效的文档分区');
        expect(mockQuery).not.toHaveBeenCalled();
      }
    );
  });

  it('按成员权限读取单篇文档', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: DOCUMENT_ID,
          partition: 'shared',
          owner_id: USER_ID,
          team_id: TEAM_ID
        }]
      } as any)
      .mockResolvedValueOnce({ rows: [{ user_id: USER_ID, is_admin: false }] } as any)
      .mockResolvedValueOnce({
        rows: [{
          id: DOCUMENT_ID,
          project_id: PROJECT_ID,
          title: '只读',
          content: '内容',
          partition: 'shared',
          owner_id: USER_ID,
          metadata: {},
          created_at: new Date('2026-05-02T00:00:00.000Z'),
          updated_at: new Date('2026-05-02T00:00:00.000Z')
        }]
      } as any);

    await withTestServer(
      (app) => app.use('/api/documents', documentRoutes),
      async (baseUrl) => {
        const { status, body } = await jsonRequest(baseUrl, `/api/documents/${DOCUMENT_ID}`, {
          headers: { Authorization: `Bearer ${authToken(USER_ID)}` }
        });
        expect(status).toBe(200);
        expect(body.data.projectId).toBe(PROJECT_ID);
        expect(body.data.ownerId).toBe(USER_ID);
      }
    );
  });
});
