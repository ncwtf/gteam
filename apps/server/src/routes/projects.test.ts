import express from 'express';
import { AddressInfo } from 'net';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import projectRoutes from './projects';
import { query } from '../db';

jest.mock('../db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

let server: Server;
let baseUrl: string;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectRoutes);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  mockQuery.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

const token = jwt.sign({ userId: 'user-1', email: 'a@b.c' }, SECRET);

function post(body: unknown, auth = true) {
  return fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

describe('POST /api/projects', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await post({ name: 'x' }, false);
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('requires a project name', async () => {
    const res = await post({ name: '   ' });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeTruthy();
  });

  it('creates the project in the user\'s team when teamId is omitted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ team_id: 'team-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ is_admin: false }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'p-1', team_id: 'team-1', name: 'Demo' }] } as any);

    const res = await post({ name: ' Demo ', description: 'd' });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data).toMatchObject({ id: 'p-1', team_id: 'team-1' });
    expect(mockQuery.mock.calls[2][1]).toEqual(['team-1', 'Demo', 'd', null]);
  });

  it('rejects users that belong to no team', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const res = await post({ name: 'Demo' });
    expect(res.status).toBe(403);
  });

  it('asks for teamId when the user is in several teams', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ team_id: 't1' }, { team_id: 't2' }] } as any);
    const res = await post({ name: 'Demo' });
    expect(res.status).toBe(400);
  });

  it('rejects non-members of an explicit team', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const res = await post({ name: 'Demo', teamId: 'other' });
    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns 500 with a message when the database fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await post({ name: 'Demo', teamId: 't1' });
    expect(res.status).toBe(500);
    const json: any = await res.json();
    expect(json.error).toBe('创建项目失败');
  });
});
