import { useEffect, useState } from 'react';
import { Document, DocumentPartition, TeamConnection } from '@gteam/shared';
import { createApiClient, useStore } from '../store';
import { getApiErrorMessage } from '../lib/apiError';
import { formatDate, normalizeDocument } from '../lib/normalize';
import { partitionLabel } from '../lib/labels';
import ErrorBanner from './ErrorBanner';

interface DocumentDetailProps {
  document: Document;
  connection: TeamConnection;
  onClose: () => void;
  onChanged: () => void;
}

function DocumentDetail({ document, connection, onClose, onChanged }: DocumentDetailProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content || '');
  const [partition, setPartition] = useState<DocumentPartition>(document.partition);
  const [tags, setTags] = useState((document.metadata?.tags || []).join(', '));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (editing) return;
    setTitle(document.title);
    setContent(document.content || '');
    setPartition(document.partition);
    setTags((document.metadata?.tags || []).join(', '));
  }, [document.id, document.title, document.content, document.partition, document.updatedAt, editing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient(connection);
        const response = await api.get(`/api/documents/${document.id}`);
        if (response.data?.success === false || !response.data?.data) {
          throw new Error(response.data?.error || '加载文档详情失败');
        }
        if (cancelled) return;
        const fresh = normalizeDocument(response.data.data);
        const current = useStore.getState().teamData[connection.id]?.documents || [];
        useStore.getState().setDocuments(
          connection.id,
          current.some((item) => item.id === fresh.id)
            ? current.map((item) => (item.id === fresh.id ? fresh : item))
            : [fresh, ...current]
        );
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, '加载文档详情失败'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [document.id, connection.id, connection.token]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const api = createApiClient(connection);
      const response = await api.put(`/api/documents/${document.id}`, {
        title: title.trim(),
        content,
        partition,
        metadata: {
          ...(document.metadata || {}),
          projectId: document.projectId,
          ownerId: document.ownerId,
          tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        }
      });
      if (response.data?.success === false) {
        throw new Error(response.data?.error || '保存文档失败');
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(getApiErrorMessage(err, '保存文档失败'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError('');
    try {
      const api = createApiClient(connection);
      const response = await api.delete(`/api/documents/${document.id}`);
      if (response.data?.success === false) {
        throw new Error(response.data?.error || '删除文档失败');
      }
      const current = useStore.getState().teamData[connection.id]?.documents || [];
      useStore.getState().setDocuments(connection.id, current.filter((item) => item.id !== document.id));
      onChanged();
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, '删除文档失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card selected">
      <div className="detail-actions" style={{ justifyContent: 'space-between' }}>
        <strong>文档详情</strong>
        <button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button>
      </div>
      <ErrorBanner message={error} />
      {editing ? (
        <div>
          <div className="form-group">
            <label>标题 *</label>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="form-group">
            <label>分区</label>
            <select value={partition} onChange={(event) => setPartition(event.target.value as DocumentPartition)}>
              <option value={DocumentPartition.Personal}>个人</option>
              <option value={DocumentPartition.Shared}>共享（只读）</option>
              <option value={DocumentPartition.Collaborative}>协作</option>
            </select>
          </div>
          <div className="form-group">
            <label>标签（逗号分隔）</label>
            <input value={tags} onChange={(event) => setTags(event.target.value)} />
          </div>
          <div className="form-group">
            <label>内容 *</label>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} style={{ minHeight: 220 }} />
          </div>
          <div className="detail-actions">
            <button type="button" className="btn" disabled={saving || !title.trim() || !content.trim()} onClick={save}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="card-title">{document.title}</div>
          <div className="card-content">
            分区：{partitionLabel[document.partition] || document.partition} · 更新：{formatDate(document.updatedAt)}
          </div>
          <pre className="detail-content">{document.content}</pre>
          <div className="detail-actions">
            <button type="button" className="btn" onClick={() => setEditing(true)}>编辑</button>
            {confirmDelete ? (
              <>
                <button type="button" className="btn btn-danger" onClick={remove} disabled={saving}>确认删除</button>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>取消</button>
              </>
            ) : (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>删除</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default DocumentDetail;
