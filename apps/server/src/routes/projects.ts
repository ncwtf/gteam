import { Router } from 'express';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';

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

    res.json({ success: true, data: result.rows });
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

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('获取项目详情错误:', error);
    res.status(500).json({ success: false, error: '获取项目详情失败' });
  }
});

// 创建项目
// teamId 可选：客户端连接只对应一台服务器，未传时使用当前用户所在的团队
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { teamId: rawTeamId, name, description, gitRepoUrl } = req.body || {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';

    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '项目名称不能为空' });
    }

    let teamId: string | undefined = rawTeamId || undefined;
    if (!teamId) {
      const teams = await query(
        'SELECT team_id FROM team_members WHERE user_id = $1 ORDER BY joined_at ASC',
        [userId]
      );
      if (teams.rows.length === 0) {
        return res.status(403).json({ success: false, error: '你还不是任何团队的成员' });
      }
      if (teams.rows.length > 1) {
        return res.status(400).json({ success: false, error: '你属于多个团队，请指定 teamId' });
      }
      teamId = teams.rows[0].team_id;
    }

    // 必须是该团队成员
    const memberCheck = await query(
      'SELECT is_admin FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: '你不是该团队成员，无法创建项目' });
    }

    const result = await query(
      'INSERT INTO projects (team_id, name, description, git_repo_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [teamId, trimmedName, description || null, gitRepoUrl || null]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('创建项目错误:', error);
    res.status(500).json({ success: false, error: '创建项目失败' });
  }
});

export default router;
