import { Router } from 'express';
import { WSEventType } from '@gteam/shared';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';
import { broadcastEvent } from '../websocket';
import { mapRequirement } from '../serialize';
import { asString, buildPatch, field, isUuid, sendPermission } from '../http';

const router = Router();

router.use(authenticateToken);

const STATUSES = new Set(['pending', 'in_progress', 'completed', 'blocked']);

async function ensureProjectRead(userId: string, projectId: string, res: any): Promise<boolean> {
  const permission = await PermissionChecker.check({
    userId,
    resourceType: 'project',
    resourceId: projectId,
    action: 'read'
  });
  if (!permission.allowed) {
    sendPermission(res, permission);
    return false;
  }
  return true;
}

async function emitRequirement(projectId: string, type: WSEventType, payload: unknown, userId?: string) {
  const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [projectId]);
  if (projectData.rows.length === 0) return;
  broadcastEvent({
    type,
    teamId: projectData.rows[0].team_id,
    projectId,
    payload,
    timestamp: new Date(),
    userId
  });
}

// 获取需求列表
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projectId = asString(req.query.projectId);

    if (projectId && !isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }
    if (projectId && !(await ensureProjectRead(userId, projectId, res))) return;

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
    res.json({ success: true, data: result.rows.map(mapRequirement) });
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
      return sendPermission(res, permission);
    }

    const result = await query('SELECT * FROM requirements WHERE id = $1', [requirementId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '需求不存在' });
    }

    res.json({ success: true, data: mapRequirement(result.rows[0]) });
  } catch (error) {
    console.error('获取需求详情错误:', error);
    res.status(500).json({ success: false, error: '获取需求详情失败' });
  }
});

// 创建需求
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projectId = field(req.body, 'projectId', 'project_id');
    const title = field(req.body, 'title');
    const description = field(req.body, 'description');
    const gitBranch = field(req.body, 'gitBranch', 'git_branch');
    const gitRepoUrl = field(req.body, 'gitRepoUrl', 'git_repo_url');
    const assigneeId = field(req.body, 'assigneeId', 'assignee_id');

    if (!projectId || !title || !String(title).trim() || !description || !gitBranch || !String(gitBranch).trim()) {
      return res.status(400).json({ success: false, error: '缺少必要字段' });
    }
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }
    if (assigneeId && !isUuid(assigneeId)) {
      return res.status(400).json({ success: false, error: '负责人 ID 无效' });
    }
    if (!(await ensureProjectRead(userId, String(projectId), res))) return;

    const result = await query(
      'INSERT INTO requirements (project_id, title, description, git_branch, git_repo_url, assignee_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [
        projectId,
        String(title).trim(),
        String(description),
        String(gitBranch).trim(),
        gitRepoUrl ? String(gitRepoUrl) : null,
        assigneeId || null,
        userId
      ]
    );

    const requirement = mapRequirement(result.rows[0]);
    await emitRequirement(String(projectId), WSEventType.RequirementCreated, requirement, userId);
    res.json({ success: true, data: requirement });
  } catch (error) {
    console.error('创建需求错误:', error);
    res.status(500).json({ success: false, error: '创建需求失败' });
  }
});

// 更新需求
router.put('/:id', async (req, res) => {
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
      action: 'write'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const title = field(req.body, 'title');
    const description = field(req.body, 'description');
    const gitBranch = field(req.body, 'gitBranch', 'git_branch');
    const gitRepoUrl = field(req.body, 'gitRepoUrl', 'git_repo_url');
    const assigneeId = field(req.body, 'assigneeId', 'assignee_id');
    const status = field(req.body, 'status');

    if (title !== undefined && !String(title).trim()) {
      return res.status(400).json({ success: false, error: '标题不能为空' });
    }
    if (description !== undefined && !String(description).trim()) {
      return res.status(400).json({ success: false, error: '描述不能为空' });
    }
    if (gitBranch !== undefined && !String(gitBranch).trim()) {
      return res.status(400).json({ success: false, error: '分支不能为空' });
    }
    if (status !== undefined && !STATUSES.has(String(status))) {
      return res.status(400).json({ success: false, error: '状态无效' });
    }
    if (assigneeId && !isUuid(assigneeId)) {
      return res.status(400).json({ success: false, error: '负责人 ID 无效' });
    }

    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = String(title).trim();
    if (description !== undefined) patch.description = String(description);
    if (gitBranch !== undefined) patch.git_branch = String(gitBranch).trim();
    if (gitRepoUrl !== undefined) patch.git_repo_url = gitRepoUrl ? String(gitRepoUrl) : null;
    if (assigneeId !== undefined) patch.assignee_id = assigneeId || null;
    if (status !== undefined) patch.status = String(status);

    const built = buildPatch('requirements', requirementId, patch);
    if (!built) {
      return res.status(400).json({ success: false, error: '没有可更新的字段' });
    }

    const result = await query(built.text, built.params);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '需求不存在' });
    }

    const requirement = mapRequirement(result.rows[0]);
    const type = status !== undefined && Object.keys(patch).length === 1
      ? WSEventType.RequirementStatusChanged
      : WSEventType.RequirementUpdated;
    await emitRequirement(result.rows[0].project_id, type, requirement, userId);
    res.json({ success: true, data: requirement });
  } catch (error) {
    console.error('更新需求错误:', error);
    res.status(500).json({ success: false, error: '更新需求失败' });
  }
});

// 更新需求状态
router.patch('/:id/status', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const requirementId = req.params.id;
    const status = field(req.body, 'status');

    if (!isUuid(requirementId)) {
      return res.status(400).json({ success: false, error: '需求 ID 无效' });
    }
    if (!status || !STATUSES.has(String(status))) {
      return res.status(400).json({ success: false, error: status ? '状态无效' : '缺少状态字段' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'requirement',
      resourceId: requirementId,
      action: 'write'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const result = await query(
      'UPDATE requirements SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, requirementId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '需求不存在' });
    }

    const requirement = mapRequirement(result.rows[0]);
    await emitRequirement(result.rows[0].project_id, WSEventType.RequirementStatusChanged, requirement, userId);
    res.json({ success: true, data: requirement });
  } catch (error) {
    console.error('更新需求状态错误:', error);
    res.status(500).json({ success: false, error: '更新需求状态失败' });
  }
});

// 删除需求
router.delete('/:id', async (req, res) => {
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
      action: 'delete'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const result = await query('DELETE FROM requirements WHERE id = $1 RETURNING project_id, title', [requirementId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '需求不存在' });
    }

    await emitRequirement(
      result.rows[0].project_id,
      WSEventType.RequirementDeleted,
      { id: requirementId, requirementId, title: result.rows[0].title },
      userId
    );
    res.json({ success: true, message: '需求已删除' });
  } catch (error) {
    console.error('删除需求错误:', error);
    res.status(500).json({ success: false, error: '删除需求失败' });
  }
});

export default router;
