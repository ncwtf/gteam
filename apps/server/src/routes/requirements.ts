import { Router } from 'express';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';
import { broadcastEvent } from '../websocket';
import { WSEventType } from '@teamctx/shared';

const router = Router();

router.use(authenticateToken);

// 获取需求列表
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId } = req.query;

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
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('获取需求列表错误:', error);
    res.status(500).json({ success: false, error: '获取需求列表失败' });
  }
});

// 创建需求
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId, title, description, gitBranch, gitRepoUrl, assigneeId } = req.body;

    if (!projectId || !title || !description || !gitBranch) {
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
      'INSERT INTO requirements (project_id, title, description, git_branch, git_repo_url, assignee_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [projectId, title, description, gitBranch, gitRepoUrl, assigneeId, userId]
    );

    const requirement = result.rows[0];

    const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [projectId]);
    if (projectData.rows.length > 0) {
      broadcastEvent({
        type: WSEventType.RequirementCreated,
        teamId: projectData.rows[0].team_id,
        projectId,
        payload: requirement,
        timestamp: new Date(),
        userId
      });
    }

    res.json({ success: true, data: requirement });
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
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: '缺少状态字段' });
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

    const requirement = result.rows[0];

    const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [requirement.project_id]);
    if (projectData.rows.length > 0) {
      broadcastEvent({
        type: WSEventType.RequirementStatusChanged,
        teamId: projectData.rows[0].team_id,
        projectId: requirement.project_id,
        payload: requirement,
        timestamp: new Date(),
        userId
      });
    }

    res.json({ success: true, data: requirement });
  } catch (error) {
    console.error('更新需求状态错误:', error);
    res.status(500).json({ success: false, error: '更新需求状态失败' });
  }
});

export default router;
