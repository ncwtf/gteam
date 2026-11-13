import { Router } from 'express';
import { WSEventType } from '@gteam/shared';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';
import { broadcastEvent } from '../websocket';
import { mapIssue, mapReply } from '../serialize';
import { asString, buildPatch, field, isUuid, sendPermission } from '../http';

const router = Router();

router.use(authenticateToken);

const STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

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

async function emitIssue(projectId: string, type: WSEventType, payload: unknown, userId?: string) {
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

// 获取问题列表
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projectId = asString(req.query.projectId);
    const status = asString(req.query.status);

    if (projectId && !isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }
    if (status && !STATUSES.has(status)) {
      return res.status(400).json({ success: false, error: '状态无效' });
    }
    if (projectId && !(await ensureProjectRead(userId, projectId, res))) return;

    let queryText = `
      SELECT DISTINCT i.* 
      FROM issues i
      JOIN projects p ON i.project_id = p.id
      JOIN teams t ON p.team_id = t.id
      JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = $1
    `;
    const params: any[] = [userId];

    if (projectId) {
      params.push(projectId);
      queryText += ` AND i.project_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      queryText += ` AND i.status = $${params.length}`;
    }

    queryText += ' ORDER BY i.created_at DESC';

    const result = await query(queryText, params);
    res.json({ success: true, data: result.rows.map(mapIssue) });
  } catch (error) {
    console.error('获取问题列表错误:', error);
    res.status(500).json({ success: false, error: '获取问题列表失败' });
  }
});

// 获取问题详情
router.get('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const issueId = req.params.id;
    if (!isUuid(issueId)) {
      return res.status(400).json({ success: false, error: '问题 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'issue',
      resourceId: issueId,
      action: 'read'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const result = await query('SELECT * FROM issues WHERE id = $1', [issueId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '问题不存在' });
    }

    res.json({ success: true, data: mapIssue(result.rows[0]) });
  } catch (error) {
    console.error('获取问题详情错误:', error);
    res.status(500).json({ success: false, error: '获取问题详情失败' });
  }
});

// 创建问题 (AI 或人工)
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projectId = field(req.body, 'projectId', 'project_id');
    const requirementId = field(req.body, 'requirementId', 'requirement_id');
    const title = field(req.body, 'title');
    const description = field(req.body, 'description');
    const priority = field(req.body, 'priority');
    const createdByAI = field(req.body, 'createdByAI', 'created_by_ai');

    if (!projectId || !title || !String(title).trim() || !description) {
      return res.status(400).json({ success: false, error: '缺少必要字段' });
    }
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }
    if (requirementId && !isUuid(requirementId)) {
      return res.status(400).json({ success: false, error: '需求 ID 无效' });
    }
    if (priority !== undefined && !PRIORITIES.has(String(priority))) {
      return res.status(400).json({ success: false, error: '优先级无效' });
    }
    if (!(await ensureProjectRead(userId, String(projectId), res))) return;

    const result = await query(
      'INSERT INTO issues (project_id, requirement_id, title, description, priority, created_by, created_by_ai) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [projectId, requirementId || null, String(title).trim(), String(description), priority || 'medium', userId, Boolean(createdByAI)]
    );

    const issue = mapIssue(result.rows[0]);
    await emitIssue(String(projectId), WSEventType.IssueCreated, issue, userId);
    res.json({ success: true, data: issue });
  } catch (error) {
    console.error('创建问题错误:', error);
    res.status(500).json({ success: false, error: '创建问题失败' });
  }
});

// 更新问题
router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const issueId = req.params.id;
    if (!isUuid(issueId)) {
      return res.status(400).json({ success: false, error: '问题 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'issue',
      resourceId: issueId,
      action: 'write'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const title = field(req.body, 'title');
    const description = field(req.body, 'description');
    const priority = field(req.body, 'priority');
    const status = field(req.body, 'status');
    const assignedTo = field(req.body, 'assignedTo', 'assigned_to');
    const requirementId = field(req.body, 'requirementId', 'requirement_id');

    if (title !== undefined && !String(title).trim()) {
      return res.status(400).json({ success: false, error: '标题不能为空' });
    }
    if (description !== undefined && !String(description).trim()) {
      return res.status(400).json({ success: false, error: '描述不能为空' });
    }
    if (priority !== undefined && !PRIORITIES.has(String(priority))) {
      return res.status(400).json({ success: false, error: '优先级无效' });
    }
    if (status !== undefined && !STATUSES.has(String(status))) {
      return res.status(400).json({ success: false, error: '状态无效' });
    }
    if (assignedTo && !isUuid(assignedTo)) {
      return res.status(400).json({ success: false, error: '负责人 ID 无效' });
    }
    if (requirementId && !isUuid(requirementId)) {
      return res.status(400).json({ success: false, error: '需求 ID 无效' });
    }

    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = String(title).trim();
    if (description !== undefined) patch.description = String(description);
    if (priority !== undefined) patch.priority = String(priority);
    if (status !== undefined) patch.status = String(status);
    if (assignedTo !== undefined) patch.assigned_to = assignedTo || null;
    if (requirementId !== undefined) patch.requirement_id = requirementId || null;

    const built = buildPatch('issues', issueId, patch);
    if (!built) {
      return res.status(400).json({ success: false, error: '没有可更新的字段' });
    }

    const result = await query(built.text, built.params);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '问题不存在' });
    }

    const issue = mapIssue(result.rows[0]);
    await emitIssue(result.rows[0].project_id, WSEventType.IssueUpdated, issue, userId);
    res.json({ success: true, data: issue });
  } catch (error) {
    console.error('更新问题错误:', error);
    res.status(500).json({ success: false, error: '更新问题失败' });
  }
});

// 更新问题状态
router.patch('/:id/status', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const issueId = req.params.id;
    const status = field(req.body, 'status');

    if (!isUuid(issueId)) {
      return res.status(400).json({ success: false, error: '问题 ID 无效' });
    }
    if (!status || !STATUSES.has(String(status))) {
      return res.status(400).json({ success: false, error: status ? '状态无效' : '缺少状态字段' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'issue',
      resourceId: issueId,
      action: 'write'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const result = await query(
      'UPDATE issues SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, issueId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '问题不存在' });
    }

    const issue = mapIssue(result.rows[0]);
    await emitIssue(result.rows[0].project_id, WSEventType.IssueUpdated, issue, userId);
    res.json({ success: true, data: issue });
  } catch (error) {
    console.error('更新问题状态错误:', error);
    res.status(500).json({ success: false, error: '更新问题状态失败' });
  }
});

// 删除问题
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const issueId = req.params.id;
    if (!isUuid(issueId)) {
      return res.status(400).json({ success: false, error: '问题 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'issue',
      resourceId: issueId,
      action: 'delete'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const result = await query('DELETE FROM issues WHERE id = $1 RETURNING project_id, title', [issueId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '问题不存在' });
    }

    await emitIssue(
      result.rows[0].project_id,
      WSEventType.IssueDeleted,
      { id: issueId, issueId, title: result.rows[0].title },
      userId
    );
    res.json({ success: true, message: '问题已删除' });
  } catch (error) {
    console.error('删除问题错误:', error);
    res.status(500).json({ success: false, error: '删除问题失败' });
  }
});

// 回复问题
router.post('/:id/replies', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const issueId = req.params.id;
    const content = field(req.body, 'content');
    const createdByAI = field(req.body, 'createdByAI', 'created_by_ai');

    if (!isUuid(issueId)) {
      return res.status(400).json({ success: false, error: '问题 ID 无效' });
    }
    if (!content || !String(content).trim()) {
      return res.status(400).json({ success: false, error: '缺少内容' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'issue',
      resourceId: issueId,
      action: 'write'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const result = await query(
      'INSERT INTO issue_replies (issue_id, user_id, content, created_by_ai) VALUES ($1, $2, $3, $4) RETURNING *',
      [issueId, userId, String(content).trim(), Boolean(createdByAI)]
    );

    const reply = mapReply(result.rows[0]);
    const issueData = await query('SELECT project_id FROM issues WHERE id = $1', [issueId]);
    if (issueData.rows.length > 0) {
      await emitIssue(issueData.rows[0].project_id, WSEventType.IssueReplied, { issueId, reply }, userId);
    }

    res.json({ success: true, data: reply });
  } catch (error) {
    console.error('回复问题错误:', error);
    res.status(500).json({ success: false, error: '回复问题失败' });
  }
});

// 获取问题回复
router.get('/:id/replies', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const issueId = req.params.id;
    if (!isUuid(issueId)) {
      return res.status(400).json({ success: false, error: '问题 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'issue',
      resourceId: issueId,
      action: 'read'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const result = await query(
      'SELECT * FROM issue_replies WHERE issue_id = $1 ORDER BY created_at ASC',
      [issueId]
    );

    res.json({ success: true, data: result.rows.map(mapReply) });
  } catch (error) {
    console.error('获取问题回复错误:', error);
    res.status(500).json({ success: false, error: '获取问题回复失败' });
  }
});

export default router;
