import { query } from './db';
import { DocumentPartition } from '@teamctx/shared';

/**
 * 权限检查系统
 * 实现三层分区模型：personal, shared, collaborative
 */

interface PermissionContext {
  userId: string;
  resourceType: 'document' | 'project' | 'requirement' | 'issue';
  resourceId: string;
  action: 'read' | 'write' | 'delete' | 'admin';
}

export class PermissionChecker {
  /**
   * 检查用户是否有权限访问资源
   */
  static async check(ctx: PermissionContext): Promise<{ allowed: boolean; reason?: string }> {
    const { userId, resourceType, resourceId, action } = ctx;

    try {
      switch (resourceType) {
        case 'document':
          return await this.checkDocumentPermission(userId, resourceId, action);
        case 'project':
          return await this.checkProjectPermission(userId, resourceId, action);
        case 'requirement':
          return await this.checkRequirementPermission(userId, resourceId, action);
        case 'issue':
          return await this.checkIssuePermission(userId, resourceId, action);
        default:
          return { allowed: false, reason: '未知的资源类型' };
      }
    } catch (error) {
      console.error('权限检查错误:', error);
      return { allowed: false, reason: '权限检查失败' };
    }
  }

  /**
   * 文档权限检查
   * - personal: 所有者读写，其他人只读
   * - shared: 所有项目成员只读
   * - collaborative: 所有项目成员读写
   */
  private static async checkDocumentPermission(
    userId: string,
    documentId: string,
    action: 'read' | 'write' | 'delete' | 'admin'
  ): Promise<{ allowed: boolean; reason?: string }> {
    const docResult = await query(
      `SELECT d.*, p.team_id 
       FROM documents d
       JOIN projects p ON d.project_id = p.id
       WHERE d.id = $1`,
      [documentId]
    );

    if (docResult.rows.length === 0) {
      return { allowed: false, reason: '文档不存在' };
    }

    const doc = docResult.rows[0];
    const partition = doc.partition as DocumentPartition;
    const ownerId = doc.owner_id;
    const teamId = doc.team_id;

    // 检查是否是项目成员
    const memberResult = await query(
      `SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId]
    );

    const isMember = memberResult.rows.length > 0;
    const isAdmin = isMember && memberResult.rows[0].is_admin;
    const isOwner = ownerId === userId;

    // 管理员有全部权限
    if (isAdmin) {
      return { allowed: true };
    }

    // Personal 分区
    if (partition === DocumentPartition.Personal) {
      if (action === 'read') {
        return { allowed: isMember, reason: isMember ? undefined : '您不是项目成员' };
      }
      if (action === 'write' || action === 'delete') {
        return { allowed: isOwner, reason: isOwner ? undefined : '只有文档所有者可以编辑' };
      }
    }

    // Shared 分区（只读）
    if (partition === DocumentPartition.Shared) {
      if (action === 'read') {
        return { allowed: isMember, reason: isMember ? undefined : '您不是项目成员' };
      }
      if (action === 'write' || action === 'delete') {
        return { allowed: isOwner, reason: isOwner ? undefined : '共享文档只有所有者可以编辑' };
      }
    }

    // Collaborative 分区
    if (partition === DocumentPartition.Collaborative) {
      if (action === 'read' || action === 'write') {
        return { allowed: isMember, reason: isMember ? undefined : '您不是项目成员' };
      }
      if (action === 'delete') {
        return { allowed: isOwner || isAdmin, reason: '只有所有者或管理员可以删除' };
      }
    }

    return { allowed: false, reason: '权限不足' };
  }

  /**
   * 项目权限检查
   */
  private static async checkProjectPermission(
    userId: string,
    projectId: string,
    action: 'read' | 'write' | 'delete' | 'admin'
  ): Promise<{ allowed: boolean; reason?: string }> {
    const projectResult = await query(
      `SELECT p.*, tm.is_admin
       FROM projects p
       JOIN team_members tm ON p.team_id = tm.team_id
       WHERE p.id = $1 AND tm.user_id = $2`,
      [projectId, userId]
    );

    if (projectResult.rows.length === 0) {
      return { allowed: false, reason: '项目不存在或您不是成员' };
    }

    const isAdmin = projectResult.rows[0].is_admin;

    if (action === 'read') {
      return { allowed: true };
    }

    if (action === 'write' || action === 'delete' || action === 'admin') {
      return { allowed: isAdmin, reason: isAdmin ? undefined : '需要管理员权限' };
    }

    return { allowed: false, reason: '权限不足' };
  }

  /**
   * 需求权限检查
   */
  private static async checkRequirementPermission(
    userId: string,
    requirementId: string,
    action: 'read' | 'write' | 'delete' | 'admin'
  ): Promise<{ allowed: boolean; reason?: string }> {
    const reqResult = await query(
      `SELECT r.*, p.team_id, tm.is_admin
       FROM requirements r
       JOIN projects p ON r.project_id = p.id
       JOIN team_members tm ON p.team_id = tm.team_id
       WHERE r.id = $1 AND tm.user_id = $2`,
      [requirementId, userId]
    );

    if (reqResult.rows.length === 0) {
      return { allowed: false, reason: '需求不存在或您不是项目成员' };
    }

    const isAdmin = reqResult.rows[0].is_admin;
    const createdBy = reqResult.rows[0].created_by;
    const assigneeId = reqResult.rows[0].assignee_id;

    if (action === 'read') {
      return { allowed: true };
    }

    if (action === 'write') {
      const canWrite = isAdmin || createdBy === userId || assigneeId === userId;
      return { allowed: canWrite, reason: canWrite ? undefined : '只有创建者、负责人或管理员可以编辑' };
    }

    if (action === 'delete') {
      const canDelete = isAdmin || createdBy === userId;
      return { allowed: canDelete, reason: canDelete ? undefined : '只有创建者或管理员可以删除' };
    }

    return { allowed: false, reason: '权限不足' };
  }

  /**
   * 问题权限检查
   */
  private static async checkIssuePermission(
    userId: string,
    issueId: string,
    action: 'read' | 'write' | 'delete' | 'admin'
  ): Promise<{ allowed: boolean; reason?: string }> {
    const issueResult = await query(
      `SELECT i.*, p.team_id, tm.is_admin
       FROM issues i
       JOIN projects p ON i.project_id = p.id
       JOIN team_members tm ON p.team_id = tm.team_id
       WHERE i.id = $1 AND tm.user_id = $2`,
      [issueId, userId]
    );

    if (issueResult.rows.length === 0) {
      return { allowed: false, reason: '问题不存在或您不是项目成员' };
    }

    const isAdmin = issueResult.rows[0].is_admin;
    const createdBy = issueResult.rows[0].created_by;

    if (action === 'read' || action === 'write') {
      return { allowed: true };
    }

    if (action === 'delete') {
      const canDelete = isAdmin || createdBy === userId;
      return { allowed: canDelete, reason: canDelete ? undefined : '只有创建者或管理员可以删除' };
    }

    return { allowed: false, reason: '权限不足' };
  }
}
