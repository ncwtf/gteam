import { Router } from 'express';
import { query } from '../db';
import { authenticateToken } from './auth';
import { broadcastEvent } from '../websocket';
import { WSEventType } from '@gteam/shared';

const router = Router();

router.use(authenticateToken);

// 报告 Git 进度 (由本地 watcher 调用)
router.post('/progress', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { requirementId, branch, repoPath, commitHash, commitMessage } = req.body;

    if (!requirementId || !branch || !repoPath || !commitHash) {
      return res.status(400).json({ success: false, error: '缺少必要字段' });
    }

    const result = await query(
      'INSERT INTO git_progress (requirement_id, user_id, branch, repo_path, commit_hash, commit_message) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [requirementId, userId, branch, repoPath, commitHash, commitMessage]
    );

    const progress = result.rows[0];

    // 获取需求和项目信息
    const reqData = await query('SELECT project_id FROM requirements WHERE id = $1', [requirementId]);
    if (reqData.rows.length > 0) {
      const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [reqData.rows[0].project_id]);
      if (projectData.rows.length > 0) {
        broadcastEvent({
          type: WSEventType.GitProgressUpdated,
          teamId: projectData.rows[0].team_id,
          projectId: reqData.rows[0].project_id,
          payload: progress,
          timestamp: new Date(),
          userId
        });
      }
    }

    res.json({ success: true, data: progress });
  } catch (error) {
    console.error('报告 Git 进度错误:', error);
    res.status(500).json({ success: false, error: '报告 Git 进度失败' });
  }
});

// 获取需求的 Git 进度
router.get('/progress/:requirementId', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const requirementId = req.params.requirementId;

    // 检查是否是项目成员
    const memberCheck = await query(
      `SELECT tm.* FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       JOIN projects p ON t.id = p.team_id
       JOIN requirements r ON p.id = r.project_id
       WHERE r.id = $1 AND tm.user_id = $2`,
      [requirementId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: '无权访问' });
    }

    const result = await query(
      'SELECT * FROM git_progress WHERE requirement_id = $1 ORDER BY timestamp DESC',
      [requirementId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('获取 Git 进度错误:', error);
    res.status(500).json({ success: false, error: '获取 Git 进度失败' });
  }
});

export default router;
