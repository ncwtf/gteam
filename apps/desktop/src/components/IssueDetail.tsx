import { useEffect, useState } from 'react';
import { Issue, IssueReply, TeamConnection } from '@gteam/shared';
import { createApiClient, useStore } from '../store';
import { getApiErrorMessage } from '../lib/apiError';
import { formatDate, normalizeIssue, normalizeReply } from '../lib/normalize';
import { issuePriorityLabel, issueStatusLabel } from '../lib/labels';
import ErrorBanner from './ErrorBanner';

interface IssueDetailProps {
  issue: Issue;
  connection: TeamConnection;
  onClose: () => void;
  onChanged: () => void;
}

function IssueDetail({ issue, connection, onClose, onChanged }: IssueDetailProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description || '');
  const [priority, setPriority] = useState<Issue['priority']>(issue.priority);
  const [status, setStatus] = useState<Issue['status']>(issue.status);
  const [replies, setReplies] = useState<IssueReply[]>([]);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [replyError, setReplyError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadReplies = async () => {
    const api = createApiClient(connection);
    const response = await api.get(`/api/issues/${issue.id}/replies`);
    if (response.data?.success === false) {
      throw new Error(response.data.error || '加载回复失败');
    }
    setReplies((response.data?.data || []).map(normalizeReply));
    setReplyError('');
  };

  useEffect(() => {
    if (editing) return;
    setTitle(issue.title);
    setDescription(issue.description || '');
    setPriority(issue.priority);
    setStatus(issue.status);
  }, [issue.id, issue.title, issue.description, issue.priority, issue.status, editing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient(connection);
        const response = await api.get(`/api/issues/${issue.id}`);
        if (response.data?.success === false || !response.data?.data) {
          throw new Error(response.data?.error || '加载问题详情失败');
        }
        if (cancelled) return;
        const fresh = normalizeIssue(response.data.data);
        const current = useStore.getState().teamData[connection.id]?.issues || [];
        useStore.getState().setIssues(
          connection.id,
          current.some((item) => item.id === fresh.id)
            ? current.map((item) => (item.id === fresh.id ? fresh : item))
            : [fresh, ...current]
        );
        const replyResponse = await api.get(`/api/issues/${issue.id}/replies`);
        if (replyResponse.data?.success === false) {
          throw new Error(replyResponse.data.error || '加载回复失败');
        }
        if (cancelled) return;
        setReplies((replyResponse.data?.data || []).map(normalizeReply));
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, '加载问题详情失败'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [issue.id, connection.id, connection.token]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const api = createApiClient(connection);
      const response = await api.put(`/api/issues/${issue.id}`, {
        title: title.trim(),
        description: description.trim(),
        priority,
        status
      });
      if (response.data?.success === false) {
        throw new Error(response.data?.error || '保存问题失败');
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(getApiErrorMessage(err, '保存问题失败'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError('');
    try {
      const api = createApiClient(connection);
      const response = await api.delete(`/api/issues/${issue.id}`);
      if (response.data?.success === false) {
        throw new Error(response.data?.error || '删除问题失败');
      }
      const current = useStore.getState().teamData[connection.id]?.issues || [];
      useStore.getState().setIssues(connection.id, current.filter((item) => item.id !== issue.id));
      onChanged();
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, '删除问题失败'));
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    setReplyError('');
    setSaving(true);
    try {
      const api = createApiClient(connection);
      const response = await api.post(`/api/issues/${issue.id}/replies`, {
        content: reply.trim(),
        createdByAI: false
      });
      if (response.data?.success === false) {
        throw new Error(response.data?.error || '回复失败');
      }
      setReply('');
      await loadReplies();
    } catch (err) {
      setReplyError(getApiErrorMessage(err, '回复失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card selected">
      <div className="detail-actions" style={{ justifyContent: 'space-between' }}>
        <strong>问题详情</strong>
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
            <label>优先级</label>
            <select value={priority} onChange={(event) => setPriority(event.target.value as Issue['priority'])}>
              {Object.entries(issuePriorityLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>状态</label>
            <select value={status} onChange={(event) => setStatus(event.target.value as Issue['status'])}>
              {Object.entries(issueStatusLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>描述 *</label>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="detail-actions">
            <button type="button" className="btn" disabled={saving || !title.trim() || !description.trim()} onClick={save}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="card-title">{issue.title}</div>
          <div className="card-content">{issue.description}</div>
          <div className="card-content">
            优先级：{issuePriorityLabel[issue.priority] || issue.priority}
            {' · '}
            状态：{issueStatusLabel[issue.status] || issue.status}
            {' · '}
            创建：{formatDate(issue.createdAt)}
          </div>
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

      <div style={{ marginTop: 16 }}>
        <strong>回复</strong>
        <ErrorBanner message={replyError} />
        {replies.length === 0 ? (
          <p className="card-content">暂无回复</p>
        ) : (
          replies.map((item) => (
            <div key={item.id} className="card" style={{ marginTop: 8 }}>
              <div className="card-content">{item.content}</div>
              <div className="card-content">{formatDate(item.createdAt)}{item.createdByAI ? ' · AI' : ''}</div>
            </div>
          ))
        )}
        <form onSubmit={sendReply} style={{ marginTop: 12 }}>
          <div className="form-group">
            <label>新回复</label>
            <textarea value={reply} onChange={(event) => setReply(event.target.value)} />
          </div>
          <button type="submit" className="btn" disabled={saving || !reply.trim()}>
            {saving ? '发送中...' : '发送回复'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default IssueDetail;
