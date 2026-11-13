import { useEffect, useState } from 'react';
import { Requirement, TeamConnection } from '@gteam/shared';
import { createApiClient, useStore } from '../store';
import { getApiErrorMessage } from '../lib/apiError';
import { formatDate, normalizeRequirement } from '../lib/normalize';
import { requirementStatusLabel } from '../lib/labels';
import ErrorBanner from './ErrorBanner';

interface RequirementDetailProps {
  requirement: Requirement;
  connection: TeamConnection;
  onClose: () => void;
  onChanged: () => void;
}

function RequirementDetail({ requirement, connection, onClose, onChanged }: RequirementDetailProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(requirement.title);
  const [description, setDescription] = useState(requirement.description || '');
  const [gitBranch, setGitBranch] = useState(requirement.gitBranch || '');
  const [gitRepoUrl, setGitRepoUrl] = useState(requirement.gitRepoUrl || '');
  const [status, setStatus] = useState(requirement.status);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (editing) return;
    setTitle(requirement.title);
    setDescription(requirement.description || '');
    setGitBranch(requirement.gitBranch || '');
    setGitRepoUrl(requirement.gitRepoUrl || '');
    setStatus(requirement.status);
  }, [requirement.id, requirement.title, requirement.description, requirement.gitBranch, requirement.gitRepoUrl, requirement.status, editing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient(connection);
        const response = await api.get(`/api/requirements/${requirement.id}`);
        if (response.data?.success === false || !response.data?.data) {
          throw new Error(response.data?.error || '加载需求详情失败');
        }
        if (cancelled) return;
        const fresh = normalizeRequirement(response.data.data);
        const current = useStore.getState().teamData[connection.id]?.requirements || [];
        useStore.getState().setRequirements(
          connection.id,
          current.some((item) => item.id === fresh.id)
            ? current.map((item) => (item.id === fresh.id ? fresh : item))
            : [fresh, ...current]
        );
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, '加载需求详情失败'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requirement.id, connection.id, connection.token]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const api = createApiClient(connection);
      const response = await api.put(`/api/requirements/${requirement.id}`, {
        title: title.trim(),
        description: description.trim(),
        gitBranch: gitBranch.trim(),
        gitRepoUrl: gitRepoUrl.trim(),
        status
      });
      if (response.data?.success === false) {
        throw new Error(response.data?.error || '保存需求失败');
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(getApiErrorMessage(err, '保存需求失败'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError('');
    try {
      const api = createApiClient(connection);
      const response = await api.delete(`/api/requirements/${requirement.id}`);
      if (response.data?.success === false) {
        throw new Error(response.data?.error || '删除需求失败');
      }
      const current = useStore.getState().teamData[connection.id]?.requirements || [];
      useStore.getState().setRequirements(connection.id, current.filter((item) => item.id !== requirement.id));
      onChanged();
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, '删除需求失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card selected">
      <div className="detail-actions" style={{ justifyContent: 'space-between' }}>
        <strong>需求详情</strong>
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
            <label>描述 *</label>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="form-group">
            <label>Git 分支 *</label>
            <input value={gitBranch} onChange={(event) => setGitBranch(event.target.value)} />
          </div>
          <div className="form-group">
            <label>Git 仓库 URL</label>
            <input value={gitRepoUrl} onChange={(event) => setGitRepoUrl(event.target.value)} />
          </div>
          <div className="form-group">
            <label>状态</label>
            <select value={status} onChange={(event) => setStatus(event.target.value as Requirement['status'])}>
              {Object.entries(requirementStatusLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="detail-actions">
            <button type="button" className="btn" disabled={saving || !title.trim() || !description.trim() || !gitBranch.trim()} onClick={save}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="card-title">{requirement.title}</div>
          <div className="card-content">{requirement.description}</div>
          <div className="card-content">分支：{requirement.gitBranch || '—'}</div>
          <div className="card-content">状态：{requirementStatusLabel[requirement.status] || requirement.status}</div>
          <div className="card-content">更新：{formatDate(requirement.updatedAt)}</div>
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

export default RequirementDetail;
