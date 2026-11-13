import { Router } from 'express';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';
import { broadcastEvent } from '../websocket';
import { WSEventType } from '@teamctx/shared';

const router = Router();

router.use(authenticateToken);

// 获取问题列表
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId, status } = req.query;

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
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('获取问题列表错误:', error);
    res.status(500).json({ success: false, error: '获取问题列表失败' });
  }
});

// 创建问题 (AI 或人工)
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId, requirementId, title, description, priority, createdByAI } = req.body;

    if (!projectId || !title || !description) {
      return res.status(400).json({ success: false, error: '缺少必要字段' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'project',
      resourceId: projectId,
      action: 'read'
    });

    if (!permission.allowed) {
      return res.status(403).json({ success: false, error: '无权访问该项目' });
    }

    const result = await query(
      'INSERT INTO issues (project_id, requirement_id, title, description, priority, created_by, created_by_ai) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [projectId, requirementId, title, description, priority || 'medium', userId, createdByAI || false]
    );

    const issue = result.rows[0];

    const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [projectId]);
    if (projectData.rows.length > 0) {
      broadcastEvent({
        type: WSEventType.IssueCreated,
        teamId: projectData.rows[0].team_id,
        projectId,
        payload: issue,
        timestamp: new Date(),
        userId
      });
    }

    res.json({ success: true, data: issue });
  } catch (error) {
    console.error('创建问题错误:', error);
    res.status(500).json({ success: false, error: '创建问题失败' });
  }
});

// 回复问题
router.post('/:id/replies', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const issueId = req.params.id;
    const { content, createdByAI } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: '缺少内容' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'issue',
      resourceId: issueId,
      action: 'write'
    });

    if (!permission.allowed) {
      return res.status(403).json({ success: false, error: permission.reason || '无权回复' });
    }

    const result = await query(
      'INSERT INTO issue_replies (issue_id, user_id, content, created_by_ai) VALUES ($1, $2, $3, $4) RETURNING *',
      [issueId, userId, content, createdByAI || false]
    );

    const reply = result.rows[0];

    const issueData = await query('SELECT project_id FROM issues WHERE id = $1', [issueId]);
    if (issueData.rows.length > 0) {
      const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [issueData.rows[0].project_id]);
      if (projectData.rows.length > 0) {
        broadcastEvent({
          type: WSEventType.IssueReplied,
          teamId: projectData.rows[0].team_id,
          projectId: issueData.rows[0].project_id,
          payload: { issueId, reply },
          timestamp: new Date(),
          userId
        });
      }
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

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'issue',
      resourceId: issueId,
      action: 'read'
    });

    if (!permission.allowed) {
      return res.status(403).json({ success: false, error: '无权访问' });
    }

    const result = await query(
      'SELECT * FROM issue_replies WHERE issue_id = $1 ORDER BY created_at ASC',
      [issueId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('获取问题回复错误:', error);
    res.status(500).json({ success: false, error: '获取问题回复失败' });
  }
});

export default router;
