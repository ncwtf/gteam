import { Router } from 'express';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';
import { broadcastEvent } from '../websocket';
import { WSEventType } from '@gteam/shared';
import { isUuid, requiredText, serializeDocument } from '../serialize';

const router = Router();

const PARTITIONS = ['personal', 'shared', 'collaborative'];

router.use(authenticateToken);

// 获取文档列表
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId, partition } = req.query;

    if (projectId !== undefined && !isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }
    if (partition !== undefined && !PARTITIONS.includes(String(partition))) {
      return res.status(400).json({ success: false, error: '无效的文档分区' });
    }

    let queryText = `
      SELECT DISTINCT d.* 
      FROM documents d
      JOIN projects p ON d.project_id = p.id
      JOIN teams t ON p.team_id = t.id
      JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = $1
    `;
    const params: any[] = [userId];

    if (projectId) {
      params.push(projectId);
      queryText += ` AND d.project_id = $${params.length}`;
    }

    if (partition) {
      params.push(partition);
      queryText += ` AND d.partition = $${params.length}`;
    }

    queryText += ' ORDER BY d.updated_at DESC';

    const result = await query(queryText, params);
    res.json({ success: true, data: result.rows.map(serializeDocument) });
  } catch (error) {
    console.error('获取文档列表错误:', error);
    res.status(500).json({ success: false, error: '获取文档列表失败' });
  }
});

// 获取文档详情
router.get('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const documentId = req.params.id;

    if (!isUuid(documentId)) {
      return res.status(400).json({ success: false, error: '文档 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'document',
      resourceId: documentId,
      action: 'read'
    });

    if (!permission.allowed) {
      return res.status(403).json({ success: false, error: permission.reason || '无权访问' });
    }

    const result = await query('SELECT * FROM documents WHERE id = $1', [documentId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '文档不存在' });
    }

    res.json({ success: true, data: serializeDocument(result.rows[0]) });
  } catch (error) {
    console.error('获取文档详情错误:', error);
    res.status(500).json({ success: false, error: '获取文档详情失败' });
  }
});

// 创建文档
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { projectId, partition, metadata } = req.body || {};
    const title = requiredText(req.body?.title);
    const content = requiredText(req.body?.content);

    if (!isUuid(projectId) || !title || !content || !partition) {
      return res.status(400).json({ success: false, error: '请填写项目、标题、内容和分区' });
    }
    if (!PARTITIONS.includes(partition)) {
      return res.status(400).json({ success: false, error: '无效的文档分区' });
    }
    if (title.length > 500) {
      return res.status(400).json({ success: false, error: '文档标题不能超过 500 个字符' });
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
      'INSERT INTO documents (project_id, title, content, partition, owner_id, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [projectId, title, content, partition, userId, JSON.stringify(metadata || {})]
    );

    const document = result.rows[0];
    const serialized = serializeDocument(document);

    const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [projectId]);
    if (projectData.rows.length > 0) {
      broadcastEvent({
        type: WSEventType.DocumentCreated,
        teamId: projectData.rows[0].team_id,
        projectId,
        payload: serialized,
        timestamp: new Date(),
        userId
      });
    }

    res.json({ success: true, data: serialized });
  } catch (error) {
    console.error('创建文档错误:', error);
    res.status(500).json({ success: false, error: '创建文档失败' });
  }
});

// 更新文档
router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const documentId = req.params.id;
    const { title, content, metadata } = req.body || {};

    if (!isUuid(documentId)) {
      return res.status(400).json({ success: false, error: '文档 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'document',
      resourceId: documentId,
      action: 'write'
    });

    if (!permission.allowed) {
      return res.status(403).json({ success: false, error: permission.reason || '无权编辑' });
    }

    const result = await query(
      'UPDATE documents SET title = COALESCE($1, title), content = COALESCE($2, content), metadata = COALESCE($3, metadata), updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [title ?? null, content ?? null, metadata ? JSON.stringify(metadata) : null, documentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '文档不存在' });
    }

    const document = result.rows[0];
    const serialized = serializeDocument(document);

    const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [document.project_id]);
    if (projectData.rows.length > 0) {
      broadcastEvent({
        type: WSEventType.DocumentUpdated,
        teamId: projectData.rows[0].team_id,
        projectId: document.project_id,
        payload: serialized,
        timestamp: new Date(),
        userId
      });
    }

    res.json({ success: true, data: serialized });
  } catch (error) {
    console.error('更新文档错误:', error);
    res.status(500).json({ success: false, error: '更新文档失败' });
  }
});

// 删除文档
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const documentId = req.params.id;

    if (!isUuid(documentId)) {
      return res.status(400).json({ success: false, error: '文档 ID 无效' });
    }

    const permission = await PermissionChecker.check({
      userId,
      resourceType: 'document',
      resourceId: documentId,
      action: 'delete'
    });

    if (!permission.allowed) {
      return res.status(403).json({ success: false, error: permission.reason || '无权删除' });
    }

    const docData = await query('SELECT project_id FROM documents WHERE id = $1', [documentId]);
    await query('DELETE FROM documents WHERE id = $1', [documentId]);

    if (docData.rows.length > 0) {
      const projectData = await query('SELECT team_id FROM projects WHERE id = $1', [docData.rows[0].project_id]);
      if (projectData.rows.length > 0) {
        broadcastEvent({
          type: WSEventType.DocumentDeleted,
          teamId: projectData.rows[0].team_id,
          projectId: docData.rows[0].project_id,
          payload: { documentId },
          timestamp: new Date(),
          userId
        });
      }
    }

    res.json({ success: true, message: '文档已删除' });
  } catch (error) {
    console.error('删除文档错误:', error);
    res.status(500).json({ success: false, error: '删除文档失败' });
  }
});

export default router;
