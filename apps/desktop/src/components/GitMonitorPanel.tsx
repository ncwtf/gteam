import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import {
  addGitMonitor,
  errorText,
  inspectGitSource,
  listGitMonitors,
  listenToGitMonitorStatus,
  removeGitMonitor,
  updateGitMonitor,
  type GitMonitor,
  type GitSourceInspection,
} from '../lib/gitWatcher';

interface EditState {
  followBranch: boolean;
  branch: string;
  requirementId: string;
  accessToken: string;
  clearAccessToken: boolean;
}

function branchLabel(repo: GitMonitor): string {
  if (repo.followBranch) {
    const name = repo.currentBranch || '检测中';
    return repo.kind === 'local' ? `跟随当前检出（${name}）` : `跟随默认分支（${name}）`;
  }
  return `固定 ${repo.branch || '未填写'}`;
}

function kindLabel(repo: GitMonitor): string {
  if (repo.kind === 'local') return '本地';
  if (repo.kind === 'remote-ssh') return '远程 SSH';
  return '远程 HTTPS';
}

function GitMonitorPanel() {
  const connections = useStore((state) => state.connections);
  const activeConnectionId = useStore((state) => state.activeConnectionId);
  const activeConnection = connections.find((connection) => connection.id === activeConnectionId) ?? null;

  const [repos, setRepos] = useState<GitMonitor[]>([]);
  const [listError, setListError] = useState('');
  const [source, setSource] = useState('');
  const [followBranch, setFollowBranch] = useState(true);
  const [branch, setBranch] = useState('');
  const [requirementId, setRequirementId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [preview, setPreview] = useState<GitSourceInspection | null>(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    followBranch: true,
    branch: '',
    requirementId: '',
    accessToken: '',
    clearAccessToken: false,
  });
  const [editError, setEditError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const showToken = /^https?:\/\//i.test(source.trim()) || preview?.kind === 'remote-https';

  const reload = async (connectionId: string | null) => {
    const all = await listGitMonitors();
    setRepos(connectionId ? all.filter((repo) => repo.connectionId === connectionId) : []);
    setListError('');
  };

  useEffect(() => {
    let cancelled = false;
    listGitMonitors()
      .then((all) => {
        if (cancelled) return;
        setRepos(activeConnectionId ? all.filter((repo) => repo.connectionId === activeConnectionId) : []);
        setListError('');
      })
      .catch((error) => {
        if (!cancelled) setListError(errorText(error));
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId]);

  useEffect(() => {
    setEditingId(null);
    setEditError('');
  }, [activeConnectionId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let stopped = false;
    listenToGitMonitorStatus((event) => {
      setRepos((current) =>
        current.map((repo) =>
          repo.id === event.id
            ? {
                ...repo,
                status: event.status,
                statusMessage: event.statusMessage,
                ownershipNote: event.ownershipNote,
                currentBranch: event.currentBranch,
                syncError: event.syncError,
              }
            : repo
        )
      );
    })
      .then((stop) => {
        if (stopped) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);

  const runInspect = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setPreview(null);
      return;
    }
    try {
      const inspection = await inspectGitSource(trimmed);
      setPreview(inspection);
      setFormError('');
    } catch (error) {
      setPreview(null);
      setFormError(errorText(error));
    }
  };

  const pickFolder = async () => {
    setFormError('');
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择 Git 仓库文件夹',
      });
      const path = typeof selected === 'string' ? selected : null;
      if (!path) return;
      setSource(path);
      await runInspect(path);
    } catch (error) {
      setFormError(`无法打开文件夹选择器：${errorText(error)}`);
    }
  };

  const handleAdd = async () => {
    if (!activeConnection) {
      setFormError('请先选择一个团队');
      return;
    }
    if (!source.trim()) {
      setFormError('请填写仓库路径或远程仓库地址');
      return;
    }
    if (!followBranch && !branch.trim()) {
      setFormError('请填写要固定的分支名，或改回跟随当前分支');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await addGitMonitor({
        connectionId: activeConnection.id,
        source: source.trim(),
        followBranch,
        branch: followBranch ? null : branch.trim(),
        requirementId: requirementId.trim() || null,
        accessToken: showToken && accessToken.trim() ? accessToken.trim() : null,
      });
      setSource('');
      setBranch('');
      setRequirementId('');
      setAccessToken('');
      setPreview(null);
      setFollowBranch(true);
      await reload(activeConnection.id);
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (repo: GitMonitor) => {
    setEditingId(repo.id);
    setEditError('');
    setEditState({
      followBranch: repo.followBranch,
      branch: repo.branch ?? '',
      requirementId: repo.requirementId ?? '',
      accessToken: '',
      clearAccessToken: false,
    });
  };

  const saveEdit = async (repo: GitMonitor) => {
    if (!editState.followBranch && !editState.branch.trim()) {
      setEditError('请填写要固定的分支名，或改回跟随当前分支');
      return;
    }
    setSavingId(repo.id);
    setEditError('');
    try {
      const updated = await updateGitMonitor({
        id: repo.id,
        followBranch: editState.followBranch,
        branch: editState.followBranch ? null : editState.branch.trim(),
        requirementId: editState.requirementId.trim() || null,
        accessToken: repo.kind === 'remote-https' && editState.accessToken.trim() ? editState.accessToken.trim() : null,
        clearAccessToken: repo.kind === 'remote-https' && editState.clearAccessToken && !editState.accessToken.trim(),
      });
      setRepos((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingId(null);
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setSavingId(null);
    }
  };

  const removeRepo = async (repo: GitMonitor) => {
    if (!window.confirm('停止监控这个仓库？你的代码不会被删除。')) return;
    try {
      await removeGitMonitor(repo.id);
      setRepos((current) => current.filter((item) => item.id !== repo.id));
      if (editingId === repo.id) setEditingId(null);
    } catch (error) {
      setListError(errorText(error));
    }
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">🌿 Git 监控设置</div>
        <div className="card-content">
          Git 监控会在后台跟踪仓库的新提交，并在填写了需求 ID 时同步到当前团队。离开本页或重启应用后，监控会继续。
          <div style={{ marginTop: '12px' }}>
            支持本地文件夹、WSL 路径（<code>\\wsl$\发行版\...</code> 或 <code>\\wsl.localhost\发行版\...</code>）以及远程地址（https://、ssh://、git@）。私有仓库使用本机已有的 Git 凭证或 SSH 密钥。
          </div>
          <div style={{ marginTop: '16px' }}>
            <div className="form-group">
              <label>仓库路径或远程地址 *</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="本地路径、\\wsl$\Ubuntu\... 或 https://github.com/owner/repo"
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value);
                    setPreview(null);
                    setFormError('');
                  }}
                  onBlur={() => {
                    void runInspect(source);
                  }}
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => void pickFolder()} style={{ whiteSpace: 'nowrap' }}>
                  选择文件夹
                </button>
              </div>
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={followBranch}
                  onChange={(event) => setFollowBranch(event.target.checked)}
                />
                跟随当前分支
              </label>
              <small style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                本地仓库跟随当前检出的分支；远程仓库跟随默认分支。取消勾选后可固定某个分支，之后也能在列表里修改。
              </small>
              {followBranch && preview?.currentBranch && (
                <small style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                  当前检出分支：{preview.currentBranch}
                </small>
              )}
            </div>

            {!followBranch && (
              <div className="form-group">
                <label>指定分支 *</label>
                <input
                  type="text"
                  placeholder="main"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                />
              </div>
            )}

            <div className="form-group">
              <label>关联需求 ID</label>
              <input
                type="text"
                placeholder="可选"
                value={requirementId}
                onChange={(event) => setRequirementId(event.target.value)}
              />
              <small style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                可选。填写后，该仓库的新提交会关联到这个需求并同步给团队。
              </small>
            </div>

            {showToken && (
              <div className="form-group">
                <label>访问令牌（可选，仅保存在本机）</label>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="留空则使用本机 Git 凭证"
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                />
                <small style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                  只用于私有 HTTPS 仓库。令牌不会上传到团队服务器，也不会写入日志。SSH 地址会使用本机 SSH 密钥。
                </small>
              </div>
            )}

            {preview?.ownershipNote && (
              <div style={{ color: '#8a5a00', marginBottom: '12px' }}>{preview.ownershipNote}</div>
            )}
            {preview && !formError && (
              <p style={{ marginBottom: '12px' }}>
                {preview.kind === 'local'
                  ? preview.hasCommits
                    ? `已识别为本地 Git 仓库${preview.currentBranch ? `，当前分支：${preview.currentBranch}` : ''}。`
                    : '已识别为本地 Git 仓库，尚无提交。出现第一次提交后会开始同步。'
                  : '已识别为远程仓库。添加时会使用本机 Git 凭证或 SSH 密钥克隆一份仅含提交记录的缓存。'}
              </p>
            )}
            {formError && <div className="error">{formError}</div>}
            <button className="btn" onClick={() => void handleAdd()} disabled={submitting || !activeConnection}>
              {submitting ? '正在添加…' : '添加仓库'}
            </button>
            {submitting && /^https?:\/\/|^ssh:\/\/|^git@/i.test(source.trim()) && (
              <small style={{ color: 'var(--text-secondary)', marginTop: '8px', display: 'block' }}>
                远程仓库需要先克隆，时间取决于仓库大小和网络。
              </small>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">当前监控的仓库 ({repos.length})</div>
        <div className="card-content">
          <p style={{ marginBottom: '12px' }}>
            {activeConnection
              ? `以下属于当前团队「${activeConnection.teamName}」。切换团队后，其他仓库仍会在后台继续监控。`
              : '请先选择一个团队。'}
          </p>
          {listError && <div className="error">{listError}</div>}
          {repos.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>暂无监控的仓库</p>
          ) : (
            repos.map((repo) => {
              const connection = connections.find((item) => item.id === repo.connectionId);
              const editing = editingId === repo.id;
              return (
                <div
                  key={repo.id}
                  style={{
                    padding: '12px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '6px',
                    marginBottom: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, wordBreak: 'break-all' }}>{repo.source}</div>
                      <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {kindLabel(repo)} | 分支: {branchLabel(repo)} | 团队: {connection?.teamName || '未知'} | 需求: {repo.requirementId || '未关联'}
                      </div>
                      <div style={{ fontSize: '13px', marginTop: '4px', color: repo.status === 'error' ? '#c00' : 'var(--text-secondary)' }}>
                        {repo.status === 'error' ? repo.statusMessage || '监控失败' : '监控中'}
                        {repo.hasAccessToken ? ' | 已保存本机访问令牌' : ''}
                      </div>
                      {repo.ownershipNote && (
                        <div style={{ fontSize: '13px', marginTop: '4px', color: '#8a5a00' }}>{repo.ownershipNote}</div>
                      )}
                      {repo.syncError && (
                        <div style={{ fontSize: '13px', marginTop: '4px', color: '#c00' }}>{repo.syncError}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <button type="button" className="btn btn-secondary" onClick={() => (editing ? setEditingId(null) : startEdit(repo))} style={{ fontSize: '14px', padding: '6px 12px' }}>
                        {editing ? '取消' : '编辑'}
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => void removeRepo(repo)} style={{ fontSize: '14px', padding: '6px 12px' }}>
                        移除
                      </button>
                    </div>
                  </div>

                  {editing && (
                    <div style={{ marginTop: '12px' }}>
                      <div className="form-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={editState.followBranch}
                            onChange={(event) => setEditState({ ...editState, followBranch: event.target.checked })}
                          />
                          跟随当前分支
                        </label>
                      </div>
                      {!editState.followBranch && (
                        <div className="form-group">
                          <label>指定分支 *</label>
                          <input
                            type="text"
                            value={editState.branch}
                            onChange={(event) => setEditState({ ...editState, branch: event.target.value })}
                          />
                        </div>
                      )}
                      <div className="form-group">
                        <label>关联需求 ID</label>
                        <input
                          type="text"
                          placeholder="可选"
                          value={editState.requirementId}
                          onChange={(event) => setEditState({ ...editState, requirementId: event.target.value })}
                        />
                      </div>
                      {repo.kind === 'remote-https' && (
                        <div className="form-group">
                          <label>访问令牌（留空表示不修改）</label>
                          <input
                            type="password"
                            autoComplete="off"
                            value={editState.accessToken}
                            onChange={(event) => setEditState({ ...editState, accessToken: event.target.value })}
                          />
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                            <input
                              type="checkbox"
                              checked={editState.clearAccessToken}
                              onChange={(event) => setEditState({ ...editState, clearAccessToken: event.target.checked })}
                            />
                            清除已保存的令牌
                          </label>
                        </div>
                      )}
                      {editError && <div className="error">{editError}</div>}
                      <button type="button" className="btn" onClick={() => void saveEdit(repo)} disabled={savingId === repo.id}>
                        {savingId === repo.id ? '保存中…' : '保存'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default GitMonitorPanel;
