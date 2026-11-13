import { useEffect, useState } from 'react';
import { Project, TeamConnection } from '@gteam/shared';
import { createApiClient, useStore } from '../store';
import { getApiErrorMessage } from '../lib/apiError';
import { formatDate, normalizeProject } from '../lib/normalize';
import ErrorBanner from './ErrorBanner';

interface ProjectDetailProps {
  project: Project;
  connection: TeamConnection;
  onClose: () => void;
  onChanged: () => void;
}

function ProjectDetail({ project, connection, onClose, onChanged }: ProjectDetailProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [gitRepoUrl, setGitRepoUrl] = useState(project.gitRepoUrl || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (editing) return;
    setName(project.name);
    setDescription(project.description || '');
    setGitRepoUrl(project.gitRepoUrl || '');
  }, [project.id, project.name, project.description, project.gitRepoUrl, editing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient(connection);
        const response = await api.get(`/api/projects/${project.id}`);
        if (response.data?.success === false || !response.data?.data) {
          throw new Error(response.data?.error || '加载项目详情失败');
        }
        if (cancelled) return;
        const fresh = normalizeProject(response.data.data);
        const current = useStore.getState().teamData[connection.id]?.projects || [];
        useStore.getState().setProjects(
          connection.id,
          current.some((item) => item.id === fresh.id)
            ? current.map((item) => (item.id === fresh.id ? fresh : item))
            : [fresh, ...current]
        );
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, '加载项目详情失败'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, connection.id, connection.token]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const api = createApiClient(connection);
      const response = await api.put(`/api/projects/${project.id}`, {
        name: name.trim(),
        description: description.trim(),
        gitRepoUrl: gitRepoUrl.trim()
      });
      if (response.data?.success === false) {
        throw new Error(response.data?.error || '保存项目失败');
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(getApiErrorMessage(err, '保存项目失败'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError('');
    try {
      const api = createApiClient(connection);
      const response = await api.delete(`/api/projects/${project.id}`);
      if (response.data?.success === false) {
        throw new Error(response.data?.error || '删除项目失败');
      }
      const current = useStore.getState().teamData[connection.id]?.projects || [];
      useStore.getState().setProjects(connection.id, current.filter((item) => item.id !== project.id));
      onChanged();
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, '删除项目失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card selected">
      <div className="detail-actions" style={{ justifyContent: 'space-between' }}>
        <strong>项目详情</strong>
        <button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button>
      </div>
      <ErrorBanner message={error} />
      {editing ? (
        <div>
          <div className="form-group">
            <label>名称 *</label>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="form-group">
            <label>描述</label>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="form-group">
            <label>Git 仓库 URL</label>
            <input value={gitRepoUrl} onChange={(event) => setGitRepoUrl(event.target.value)} />
          </div>
          <div className="detail-actions">
            <button type="button" className="btn" onClick={save} disabled={saving || !name.trim()}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="card-title">{project.name}</div>
          <div className="card-content">{project.description || '暂无描述'}</div>
          <div className="card-content">仓库：{project.gitRepoUrl || '未设置'}</div>
          <div className="card-content">更新：{formatDate(project.updatedAt)}</div>
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

export default ProjectDetail;
