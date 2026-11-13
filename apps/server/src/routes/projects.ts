import { Router } from 'express';
import { WSEventType } from '@gteam/shared';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';
import { broadcastEvent } from '../websocket';
import { mapProject } from '../serialize';
import { buildPatch, field, isUuid, sendPermission } from '../http';

const router = Router();

router.use(authenticateToken);

function emitProject(teamId: string, projectId: string, type: WSEventType, payload: unknown, userId?: string) {
  broadcastEvent({
    type,
    teamId,
    projectId,
    payload,
    timestamp: new Date(),
    userId
  });
}

// 获取用户的项目列表（仅限其所在团队）
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;

    const result = await query(
      `SELECT DISTINCT p.* 
       FROM projects p
       JOIN teams t ON p.team_id = t.id
       JOIN team_members tm ON t.id = tm.team_id
       WHERE tm.user_id = $1
       ORDER BY p.updated_at DESC`,
      [userId]
    );

    res.json({ success: true, data: result.rows.map(mapProject) });
  } catch (error) {
    console.error('获取项目列表错误:', error);
    res.status(500).json({ success: false, error: '获取项目列表失败' });
  }
});

// 获取项目详情
router.get('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projectId = req.params.id;
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'project',
      resourceId: projectId,
      action: 'read'
    });

    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const result = await query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    res.json({ success: true, data: mapProject(result.rows[0]) });
  } catch (error) {
    console.error('获取项目详情错误:', error);
    res.status(500).json({ success: false, error: '获取项目详情失败' });
  }
});

// 创建项目（团队管理员）
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const teamId = field(req.body, 'teamId', 'team_id');
    const name = field(req.body, 'name');
    const description = field(req.body, 'description');
    const gitRepoUrl = field(req.body, 'gitRepoUrl', 'git_repo_url');

    if (!teamId || !name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: '缺少必要字段' });
    }
    if (!isUuid(teamId)) {
      return res.status(400).json({ success: false, error: '团队 ID 无效' });
    }

    const memberCheck = await query(
      'SELECT is_admin FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );

    if (memberCheck.rows.length === 0 || !memberCheck.rows[0].is_admin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }

    const result = await query(
      'INSERT INTO projects (team_id, name, description, git_repo_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [teamId, String(name).trim(), description ? String(description) : null, gitRepoUrl ? String(gitRepoUrl) : null]
    );

    const project = mapProject(result.rows[0]);
    emitProject(String(teamId), project.id, WSEventType.ProjectCreated, project, userId);
    res.json({ success: true, data: project });
  } catch (error) {
    console.error('创建项目错误:', error);
    res.status(500).json({ success: false, error: '创建项目失败' });
  }
});

// 更新项目（团队管理员）
router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projectId = req.params.id;
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'project',
      resourceId: projectId,
      action: 'write'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const name = field(req.body, 'name');
    const description = field(req.body, 'description');
    const gitRepoUrl = field(req.body, 'gitRepoUrl', 'git_repo_url');
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ success: false, error: '项目名称不能为空' });
    }

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (description !== undefined) patch.description = description ? String(description) : null;
    if (gitRepoUrl !== undefined) patch.git_repo_url = gitRepoUrl ? String(gitRepoUrl) : null;

    const built = buildPatch('projects', projectId, patch);
    if (!built) {
      return res.status(400).json({ success: false, error: '没有可更新的字段' });
    }

    const result = await query(built.text, built.params);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const project = mapProject(result.rows[0]);
    emitProject(result.rows[0].team_id, project.id, WSEventType.ProjectUpdated, project, userId);
    res.json({ success: true, data: project });
  } catch (error) {
    console.error('更新项目错误:', error);
    res.status(500).json({ success: false, error: '更新项目失败' });
  }
});

// 删除项目（团队管理员）
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projectId = req.params.id;
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'project',
      resourceId: projectId,
      action: 'delete'
    });
    if (!permission.allowed) {
      return sendPermission(res, permission);
    }

    const result = await query('DELETE FROM projects WHERE id = $1 RETURNING *', [projectId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    const row = result.rows[0];
    emitProject(row.team_id, row.id, WSEventType.ProjectDeleted, { id: row.id, name: row.name }, userId);
    res.json({ success: true, message: '项目已删除' });
  } catch (error) {
    console.error('删除项目错误:', error);
    res.status(500).json({ success: false, error: '删除项目失败' });
  }
});

export default router;
