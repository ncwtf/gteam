import { Router } from 'express';
import { DocumentPartition, WSEventType } from '@gteam/shared';
import { query } from '../db';
import { authenticateToken } from './auth';
import { PermissionChecker } from '../permissions';
import { broadcastEvent } from '../websocket';
import { mapDocument } from '../serialize';
import { asString, buildPatch, field, isUuid, sendPermission } from '../http';

const router = Router();

router.use(authenticateToken);

const PARTITIONS = new Set<string>(Object.values(DocumentPartition));

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

async function emitDocument(projectId: string, type: WSEventType, payload: unknown, userId?: string) {
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

// 获取文档列表
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projectId = asString(req.query.projectId);
    const partition = asString(req.query.partition);

    if (projectId && !isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }
    if (partition && !PARTITIONS.has(partition)) {
      return res.status(400).json({ success: false, error: '分区无效' });
    }
    if (projectId && !(await ensureProjectRead(userId, projectId, res))) return;

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
    res.json({ success: true, data: result.rows.map(mapDocument) });
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
      return sendPermission(res, permission);
    }

    const result = await query('SELECT * FROM documents WHERE id = $1', [documentId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '文档不存在' });
    }

    res.json({ success: true, data: mapDocument(result.rows[0]) });
  } catch (error) {
    console.error('获取文档详情错误:', error);
    res.status(500).json({ success: false, error: '获取文档详情失败' });
  }
});

// 创建文档
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const projectId = field(req.body, 'projectId', 'project_id');
    const title = field(req.body, 'title');
    const content = field(req.body, 'content');
    const partition = field(req.body, 'partition');
    const metadata = field(req.body, 'metadata');

    if (!projectId || !title || !String(title).trim() || content == null || content === '' || !partition) {
      return res.status(400).json({ success: false, error: '缺少必要字段' });
    }
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, error: '项目 ID 无效' });
    }
    if (!PARTITIONS.has(String(partition))) {
      return res.status(400).json({ success: false, error: '分区无效' });
    }
    if (!(await ensureProjectRead(userId, String(projectId), res))) return;

    const result = await query(
      'INSERT INTO documents (project_id, title, content, partition, owner_id, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [projectId, String(title).trim(), String(content), partition, userId, JSON.stringify(metadata || {})]
    );

    const document = mapDocument(result.rows[0]);
    await emitDocument(String(projectId), WSEventType.DocumentCreated, document, userId);
    res.json({ success: true, data: document });
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
      return sendPermission(res, permission);
    }

    const title = field(req.body, 'title');
    const content = field(req.body, 'content');
    const partition = field(req.body, 'partition');
    const metadata = field(req.body, 'metadata');

    if (title !== undefined && !String(title).trim()) {
      return res.status(400).json({ success: false, error: '标题不能为空' });
    }
    if (content !== undefined && !String(content)) {
      return res.status(400).json({ success: false, error: '内容不能为空' });
    }
    if (partition !== undefined && !PARTITIONS.has(String(partition))) {
      return res.status(400).json({ success: false, error: '分区无效' });
    }

    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = String(title).trim();
    if (content !== undefined) patch.content = String(content);
    if (partition !== undefined) patch.partition = String(partition);
    if (metadata !== undefined) patch.metadata = JSON.stringify(metadata ?? {});

    const built = buildPatch('documents', documentId, patch);
    if (!built) {
      return res.status(400).json({ success: false, error: '没有可更新的字段' });
    }

    const result = await query(built.text, built.params);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '文档不存在' });
    }

    const document = mapDocument(result.rows[0]);
    await emitDocument(result.rows[0].project_id, WSEventType.DocumentUpdated, document, userId);
    res.json({ success: true, data: document });
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
      return sendPermission(res, permission);
    }

    const result = await query('DELETE FROM documents WHERE id = $1 RETURNING project_id', [documentId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '文档不存在' });
    }

    await emitDocument(
      result.rows[0].project_id,
      WSEventType.DocumentDeleted,
      { documentId, id: documentId },
      userId
    );
    res.json({ success: true, message: '文档已删除' });
  } catch (error) {
    console.error('删除文档错误:', error);
    res.status(500).json({ success: false, error: '删除文档失败' });
  }
});

export default router;
