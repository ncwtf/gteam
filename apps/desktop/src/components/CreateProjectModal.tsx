import { useState } from 'react';
import { TeamConnection } from '@gteam/shared';
import { createApiClient, useStore } from '../store';
import { getApiErrorMessage } from '../lib/apiError';
import { normalizeProject } from '../lib/normalize';
import { Project } from '@gteam/shared';
import Modal from './Modal';
import ErrorBanner from './ErrorBanner';

interface CreateProjectModalProps {
  connection: TeamConnection;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

function CreateProjectModal({ connection, onClose, onCreated }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const api = createApiClient(connection);
      let teamId = connection.teamId;
      if (!teamId) {
        const teamResponse = await api.get('/api/auth/team-info');
        if (teamResponse.data?.success === false || !teamResponse.data?.data?.id) {
          throw new Error(teamResponse.data?.error || '未找到团队，无法创建项目');
        }
        teamId = teamResponse.data.data.id as string;
        useStore.getState().updateConnection(connection.id, {
          teamId,
          teamName: teamResponse.data.data.name || connection.teamName,
          isAdmin: Boolean(teamResponse.data.data.isAdmin)
        });
      }

      const response = await api.post('/api/projects', {
        teamId,
        name: name.trim(),
        description: description.trim() || undefined,
        gitRepoUrl: gitRepoUrl.trim() || undefined
      });
      if (response.data?.success === false || !response.data?.data) {
        throw new Error(response.data?.error || '创建项目失败');
      }
      onCreated(normalizeProject(response.data.data));
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, '创建项目失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="新建项目" onClose={onClose}>
      <ErrorBanner message={error} />
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>名称 *</label>
          <input value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
        </div>
        <div className="form-group">
          <label>描述</label>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div className="form-group">
          <label>Git 仓库 URL</label>
          <input
            value={gitRepoUrl}
            onChange={(event) => setGitRepoUrl(event.target.value)}
            placeholder="https://github.com/org/repo"
          />
        </div>
        <div className="detail-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="btn" disabled={loading}>{loading ? '创建中...' : '创建项目'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default CreateProjectModal;
