import { Router } from 'express';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';
import { isUuid, optionalText, requiredText, serializeProject } from '../serialize';

const router = Router();

router.use(authenticateToken);

// 获取用户的项目列表
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

    res.json({ success: true, data: result.rows.map(serializeProject) });
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
      return res.status(403).json({ success: false, error: permission.reason || '无权访问' });
    }

    const result = await query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '项目不存在' });
    }

    res.json({ success: true, data: serializeProject(result.rows[0]) });
  } catch (error) {
    console.error('获取项目详情错误:', error);
    res.status(500).json({ success: false, error: '获取项目详情失败' });
  }
});

// 创建项目（仅团队管理员）
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { teamId } = req.body || {};
    const name = requiredText(req.body?.name);
    const description = optionalText(req.body?.description);
    const gitRepoUrl = optionalText(req.body?.gitRepoUrl ?? req.body?.git_repo_url);

    if (!isUuid(teamId) || !name) {
      return res.status(400).json({ success: false, error: '请填写团队和项目名称' });
    }
    if (name.length > 255) {
      return res.status(400).json({ success: false, error: '项目名称不能超过 255 个字符' });
    }
    if (gitRepoUrl && gitRepoUrl.length > 500) {
      return res.status(400).json({ success: false, error: 'Git 仓库地址不能超过 500 个字符' });
    }

    const memberCheck = await query(
      'SELECT is_admin FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: '你不是该团队的成员，无法创建项目' });
    }
    if (!memberCheck.rows[0].is_admin) {
      return res.status(403).json({ success: false, error: '需要管理员权限才能创建项目' });
    }

    const result = await query(
      'INSERT INTO projects (team_id, name, description, git_repo_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [teamId, name, description, gitRepoUrl]
    );

    res.json({ success: true, data: serializeProject(result.rows[0]) });
  } catch (error) {
    console.error('创建项目错误:', error);
    res.status(500).json({ success: false, error: '创建项目失败' });
  }
});

export default router;
