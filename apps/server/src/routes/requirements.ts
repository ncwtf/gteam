import { Router } from 'express';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';
import { broadcastEvent } from '../websocket';
import { WSEventType } from '@gteam/shared';
import { isUuid, optionalText, requiredText, serializeRequirement } from '../serialize';

const router = Router();

const STATUSES = ['pending', 'in_progress', 'completed', 'blocked'];

router.use(authenticateToken);

// 获取需求列表
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId } = req.query;

    if (projectId !== undefined && !isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }

    let queryText = `
      SELECT DISTINCT r.* 
      FROM requirements r
      JOIN projects p ON r.project_id = p.id
      JOIN teams t ON p.team_id = t.id
      JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = $1
    `;
    const params: any[] = [userId];

    if (projectId) {
      params.push(projectId);
      queryText += ` AND r.project_id = $${params.length}`;
    }

    queryText += ' ORDER BY r.updated_at DESC';

    const result = await query(queryText, params);
    res.json({ success: true, data: result.rows.map(serializeRequirement) });
  } catch (error) {
    console.error('获取需求列表错误:', error);
    res.status(500).json({ success: false, error: '获取需求列表失败' });
  }
});

// 获取需求详情
router.get('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const requirementId = req.params.id;

    if (!isUuid(requirementId)) {
      return res.status(400).json({ success: false, error: '需求 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'requirement',
      resourceId: requirementId,
      action: 'read'
    });

    if (!permission.allowed) {
      return res.status(403).json({ success: false, error: permission.reason || '无权访问' });
    }

    const result = await query('SELECT * FROM requirements WHERE id = $1', [requirementId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '需求不存在' });
    }

    res.json({ success: true, data: serializeRequirement(result.rows[0]) });
  } catch (error) {
    console.error('获取需求详情错误:', error);
    res.status(500).json({ success: false, error: '获取需求详情失败' });
  }
});

// 创建需求
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId, assigneeId } = req.body || {};
    const title = requiredText(req.body?.title);
    const description = requiredText(req.body?.description);
    const gitBranch = requiredText(req.body?.gitBranch ?? req.body?.git_branch);
    const gitRepoUrl = optionalText(req.body?.gitRepoUrl ?? req.body?.git_repo_url);

    if (!isUuid(projectId) || !title || !description || !gitBranch) {
      return res.status(400).json({ success: false, error: '请填写项目、标题、描述和 Git 分支' });
    }
    if (title.length > 500) {
      return res.status(400).json({ success: false, error: '需求标题不能超过 500 个字符' });
    }
    if (gitBranch.length > 255) {
      return res.status(400).json({ success: false, error: 'Git 分支名不能超过 255 个字符' });
    }
    if (gitRepoUrl && gitRepoUrl.length > 500) {
      return res.status(400).json({ success: false, error: 'Git 仓库地址不能超过 500 个字符' });
    }
    if (assigneeId !== undefined && assigneeId !== null && assigneeId !== '' && !isUuid(assigneeId)) {
      return res.status(400).json({ success: false, error: '负责人 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'project',
      resourceId: projectId,
      action: 'read'
    });

    if (!permission.allowed) {
      return res.status(403).json({ success: false, error: permission.reason || '无权访问该项目' });
    }

    const result = await query(
      'INSERT INTO requirements (project_id, title, description, git_branch, git_repo_url, assignee_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [projectId, title, description, gitBranch, gitRepoUrl, assigneeId ? assigneeId : null, userId]
    );

    const requirement = result.rows[0];
    const serialized = serializeRequirement(requirement);

    const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [projectId]);
    if (projectData.rows.length > 0) {
      broadcastEvent({
        type: WSEventType.RequirementCreated,
        teamId: projectData.rows[0].team_id,
        projectId,
        payload: serialized,
        timestamp: new Date(),
        userId
      });
    }

    res.json({ success: true, data: serialized });
  } catch (error) {
    console.error('创建需求错误:', error);
    res.status(500).json({ success: false, error: '创建需求失败' });
  }
});

// 更新需求状态
router.patch('/:id/status', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const requirementId = req.params.id;
    const { status } = req.body || {};

    if (!isUuid(requirementId)) {
      return res.status(400).json({ success: false, error: '需求 ID 无效' });
    }
    if (!status || !STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: '无效的需求状态' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'requirement',
      resourceId: requirementId,
      action: 'write'
    });

    if (!permission.allowed) {
      return res.status(403).json({ success: false, error: permission.reason || '无权编辑' });
    }

    const result = await query(
      'UPDATE requirements SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, requirementId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '需求不存在' });
    }

    const requirement = result.rows[0];
    const serialized = serializeRequirement(requirement);

    const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [requirement.project_id]);
    if (projectData.rows.length > 0) {
      broadcastEvent({
        type: WSEventType.RequirementStatusChanged,
        teamId: projectData.rows[0].team_id,
        projectId: requirement.project_id,
        payload: serialized,
        timestamp: new Date(),
        userId
      });
    }

    res.json({ success: true, data: serialized });
  } catch (error) {
    console.error('更新需求状态错误:', error);
    res.status(500).json({ success: false, error: '更新需求状态失败' });
  }
});

export default router;
