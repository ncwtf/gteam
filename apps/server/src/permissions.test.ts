/**
 * 权限测试
 * 测试三层分区模型的权限规则
 */

import { PermissionChecker } from './permissions';
import { query } from './db';

// Mock database queries
jest.mock('./db', () => ({
  query: jest.fn()
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('PermissionChecker', () => {
  beforeEach(() => {
    mockQuery.mockClear();
  });

  describe('Document Permissions', () => {
    const mockDoc = {
      id: 'doc-1',
      partition: 'personal',
      owner_id: 'user-1',
      team_id: 'team-1'
    };

    it('should allow owner to read/write personal documents', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDoc] } as any)
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', is_admin: false }] } as any);

      const result = await PermissionChecker.check({
        userId: 'user-1',
        resourceType: 'document',
        resourceId: 'doc-1',
        action: 'write'
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow team members to read personal documents', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDoc] } as any)
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-2', is_admin: false }] } as any);

      const result = await PermissionChecker.check({
        userId: 'user-2',
        resourceType: 'document',
        resourceId: 'doc-1',
        action: 'read'
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny non-owner from writing personal documents', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDoc] } as any)
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-2', is_admin: false }] } as any);

      const result = await PermissionChecker.check({
        userId: 'user-2',
        resourceType: 'document',
        resourceId: 'doc-1',
        action: 'write'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('所有者');
    });

    it('should allow team members to read/write collaborative documents', async () => {
      const collabDoc = { ...mockDoc, partition: 'collaborative' };
      mockQuery
        .mockResolvedValueOnce({ rows: [collabDoc] } as any)
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-2', is_admin: false }] } as any);

      const result = await PermissionChecker.check({
        userId: 'user-2',
        resourceType: 'document',
        resourceId: 'doc-1',
        action: 'write'
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow admins full access', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockDoc] } as any)
        .mockResolvedValueOnce({ rows: [{ user_id: 'admin-1', is_admin: true }] } as any);

      const result = await PermissionChecker.check({
        userId: 'admin-1',
        resourceType: 'document',
        resourceId: 'doc-1',
        action: 'delete'
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Shared Documents', () => {
    const sharedDoc = {
      id: 'doc-2',
      partition: 'shared',
      owner_id: 'user-1',
      team_id: 'team-1'
    };

    it('should allow all team members to read shared documents', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [sharedDoc] } as any)
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-2', is_admin: false }] } as any);

      const result = await PermissionChecker.check({
        userId: 'user-2',
        resourceType: 'document',
        resourceId: 'doc-2',
        action: 'read'
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny non-owner from writing shared documents', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [sharedDoc] } as any)
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-2', is_admin: false }] } as any);

      const result = await PermissionChecker.check({
        userId: 'user-2',
        resourceType: 'document',
        resourceId: 'doc-2',
        action: 'write'
      });

      expect(result.allowed).toBe(false);
    });
  });
});
