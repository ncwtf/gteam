import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { query, getClient } from '../db';

const router = Router();

const JWT_SECRET: string = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '7d';

// 服务器初始化状态：全新服务器（还没有任何用户）需要先创建团队
router.get('/setup-status', async (_req, res) => {
  try {
    const r = await query('SELECT COUNT(*)::int AS n FROM users');
    res.json({ success: true, data: { needsSetup: r.rows[0].n === 0 } });
  } catch (error) {
    console.error('获取初始化状态错误:', error);
    res.status(500).json({ success: false, error: '获取初始化状态失败' });
  }
});

// 首次初始化：仅在没有任何用户时可用，创建第一个管理员和团队
router.post('/setup', async (req, res) => {
  const { teamName, email, password, name } = req.body || {};
  if (!teamName || !email || !password) {
    return res.status(400).json({ success: false, error: '缺少团队名、邮箱或密码' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ success: false, error: '密码至少 8 位' });
  }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // 加锁避免并发初始化
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const count = await client.query('SELECT COUNT(*)::int AS n FROM users');
    if (count.rows[0].n > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: '服务器已初始化，请登录或使用邀请码加入' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, passwordHash, name || String(email).split('@')[0]]
    );
    const user = userResult.rows[0];
    const teamResult = await client.query('INSERT INTO teams (name) VALUES ($1) RETURNING id, name', [teamName]);
    const team = teamResult.rows[0];
    await client.query(
      'INSERT INTO team_members (team_id, user_id, role, is_admin) VALUES ($1, $2, $3, $4)',
      [team.id, user.id, '管理员', true]
    );
    await client.query('COMMIT');

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
    res.json({ success: true, data: { user, token, teamName: team.name, teamId: team.id } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('初始化错误:', error);
    res.status(500).json({ success: false, error: '初始化失败' });
  } finally {
    client.release();
  }
});

// 注册
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ success: false, error: '缺少必要字段' });
    }

    // 关闭开放注册：已有用户后，新成员必须通过邀请码加入
    const anyUser = await query('SELECT 1 FROM users LIMIT 1');
    if (anyUser.rows.length > 0) {
      return res.status(403).json({ success: false, error: '请使用邀请码加入团队' });
    }

    // 检查用户是否已存在
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: '用户已存在' });
    }

    // 哈希密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 创建用户
    const result = await query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, passwordHash, name]
    );

    const user = result.rows[0];

    // 生成 JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

    res.json({
      success: true,
      data: { user, token }
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ success: false, error: '注册失败' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: '缺少邮箱或密码' });
    }

    // 查找用户
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: '邮箱或密码错误' });
    }

    const user = result.rows[0];

    // 验证密码
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: '邮箱或密码错误' });
    }

    // 生成 JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          created_at: user.created_at
        },
        token
      }
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ success: false, error: '登录失败' });
  }
});

// 验证 token
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const result = await query('SELECT id, email, name, created_at FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ success: false, error: '获取用户信息失败' });
  }
});

// 创建邀请码
router.post('/create-invite', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { teamId, expiresInDays, maxUses } = req.body;

    if (!teamId) {
      return res.status(400).json({ success: false, error: '缺少 teamId' });
    }

    // 检查是否是团队管理员
    const adminCheck = await query(
      'SELECT is_admin FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );

    if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }

    // 生成邀请码
    const code = randomBytes(16).toString('hex');
    const expiresAt = expiresInDays 
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const result = await query(
      'INSERT INTO invites (team_id, code, created_by, expires_at, max_uses) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [teamId, code, userId, expiresAt, maxUses || null]
    );

    const invite = result.rows[0];

    // 获取团队信息
    const teamResult = await query('SELECT name FROM teams WHERE id = $1', [teamId]);
    const teamName = teamResult.rows[0]?.name || 'Team';

    // 生成邀请链接
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
    const inviteUrl = `gteam://join?server=${encodeURIComponent(serverUrl)}&invite=${code}`;

    res.json({
      success: true,
      data: {
        ...invite,
        teamName,
        inviteUrl
      }
    });
  } catch (error) {
    console.error('创建邀请码错误:', error);
    res.status(500).json({ success: false, error: '创建邀请码失败' });
  }
});

// 使用邀请码加入团队
router.post('/join-invite', async (req, res) => {
  try {
    const { inviteCode, email, password, name } = req.body;

    if (!inviteCode || !email || !password) {
      return res.status(400).json({ success: false, error: '缺少必要字段' });
    }

    // 查找邀请码
    const inviteResult = await query(
      'SELECT * FROM invites WHERE code = $1',
      [inviteCode]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: '邀请码不存在' });
    }

    const invite = inviteResult.rows[0];

    // 检查邀请码是否过期
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: '邀请码已过期' });
    }

    // 检查使用次数
    if (invite.max_uses && invite.current_uses >= invite.max_uses) {
      return res.status(400).json({ success: false, error: '邀请码使用次数已达上限' });
    }

    // 检查用户是否已存在
    let user;
    const existingUser = await query('SELECT * FROM users WHERE email = $1', [email]);

    if (existingUser.rows.length > 0) {
      // 用户已存在，验证密码
      user = existingUser.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ success: false, error: '邮箱或密码错误' });
      }
    } else {
      // 创建新用户
      const passwordHash = await bcrypt.hash(password, 10);
      const newUserResult = await query(
        'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *',
        [email, passwordHash, name || email.split('@')[0]]
      );
      user = newUserResult.rows[0];
    }

    // 检查用户是否已在团队中
    const memberCheck = await query(
      'SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2',
      [invite.team_id, user.id]
    );

    if (memberCheck.rows.length === 0) {
      // 添加用户到团队
      await query(
        'INSERT INTO team_members (team_id, user_id, role, is_admin) VALUES ($1, $2, $3, $4)',
        [invite.team_id, user.id, '其他', false]
      );
    }

    // 更新邀请码使用次数
    await query(
      'UPDATE invites SET current_uses = current_uses + 1 WHERE id = $1',
      [invite.id]
    );

    // 获取团队信息
    const teamResult = await query('SELECT name FROM teams WHERE id = $1', [invite.team_id]);
    const teamName = teamResult.rows[0]?.name || 'Team';

    // 生成 JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        token,
        teamName,
        teamId: invite.team_id
      }
    });
  } catch (error) {
    console.error('加入邀请错误:', error);
    res.status(500).json({ success: false, error: '加入邀请失败' });
  }
});

// 获取团队信息（用于客户端显示）
router.get('/team-info', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.userId;

    // 获取用户所属的第一个团队（简化实现）
    const teamResult = await query(
      `SELECT t.* FROM teams t
       JOIN team_members tm ON t.id = tm.team_id
       WHERE tm.user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (teamResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: '未找到团队' });
    }

    res.json({ success: true, data: teamResult.rows[0] });
  } catch (error) {
    console.error('获取团队信息错误:', error);
    res.status(500).json({ success: false, error: '获取团队信息失败' });
  }
});

// 认证中间件
export function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: '未提供认证令牌' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ success: false, error: '令牌无效' });
    }
    req.user = user;
    next();
  });
}

export default router;
