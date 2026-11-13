import { useEffect, useState } from 'react';
import { useStore } from '../store';
import {
  addGitMonitor,
  formatInvokeError,
  listGitMonitors,
  listenToMonitorUpdates,
  loadRequirementOptions,
  pickRepositoryFolder,
  removeGitMonitor,
  updateGitMonitor,
  type GitMonitor,
  type RequirementOption,
} from '../lib/gitMonitor';

interface FormState {
  location: string;
  followBranch: boolean;
  branch: string;
  requirementId: string;
  accessToken: string;
  clearToken: boolean;
}

const emptyForm = (): FormState => ({
  location: '',
  followBranch: true,
  branch: '',
  requirementId: '',
  accessToken: '',
  clearToken: false,
});

function GitMonitorSettings() {
  const { connections, getActiveConnection } = useStore();
  const activeConnection = getActiveConnection();
  const [monitors, setMonitors] = useState<GitMonitor[]>([]);
  const [requirements, setRequirements] = useState<RequirementOption[]>([]);
  const [requirementsNote, setRequirementsNote] = useState('');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<FormState>(emptyForm);
  const [editingHasToken, setEditingHasToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    setEditingId(null);
    setError('');

    listGitMonitors()
      .then((items) => {
        if (!cancelled) {
          setMonitors(items);
          setListError('');
        }
      })
      .catch((loadError) => {
        if (!cancelled) setListError(formatInvokeError(loadError));
      });

    listenToMonitorUpdates((monitor) => {
      setMonitors((current) => {
        const index = current.findIndex((item) => item.id === monitor.id);
        if (index === -1) return [...current, monitor];
        const next = current.slice();
        next[index] = monitor;
        return next;
      });
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeConnection?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!activeConnection) {
      setRequirements([]);
      setRequirementsNote('');
      return;
    }
    loadRequirementOptions(activeConnection)
      .then((options) => {
        if (cancelled) return;
        setRequirements(options);
        setRequirementsNote(options.length === 0 ? '没有可关联的需求，仍可留空。' : '');
      })
      .catch(() => {
        if (cancelled) return;
        setRequirements([]);
        setRequirementsNote('暂时无法加载需求列表，仍可手动填写需求 ID，或留空。');
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnection?.id]);

  const teamMonitors = monitors.filter((monitor) => monitor.connectionId === activeConnection?.id);

  const handleAdd = async () => {
    if (!activeConnection) return;
    setError('');
    setSubmitting(true);
    try {
      const created = await addGitMonitor(activeConnection.id, form);
      setMonitors((current) => [...current.filter((item) => item.id !== created.id), created]);
      setForm(emptyForm());
    } catch (addError) {
      setError(formatInvokeError(addError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSave = async () => {
    if (!editingId) return;
    setError('');
    setSubmitting(true);
    try {
      const updated = await updateGitMonitor(editingId, editing);
      setMonitors((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingId(null);
    } catch (saveError) {
      setError(formatInvokeError(saveError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (monitor: GitMonitor) => {
    setError('');
    try {
      await removeGitMonitor(monitor.id);
      setMonitors((current) => current.filter((item) => item.id !== monitor.id));
      if (editingId === monitor.id) setEditingId(null);
    } catch (removeError) {
      setError(formatInvokeError(removeError));
    }
  };

  const startEdit = (monitor: GitMonitor) => {
    setEditingId(monitor.id);
    setEditingHasToken(monitor.hasToken);
    setEditing({
      location: monitor.path,
      followBranch: monitor.branchMode !== 'pin',
      branch: monitor.branch ?? '',
      requirementId: monitor.requirementId ?? '',
      accessToken: '',
      clearToken: false,
    });
    setError('');
  };

  if (!activeConnection) {
    return <p style={{ color: 'var(--text-secondary)' }}>请先选择一个团队。</p>;
  }

  return (
    <div>
      {error && <ErrorBanner message={error} />}
      <div className="card">
        <div className="card-title">🌿 Git 监控设置</div>
        <div className="card-content">
          Git 监控会在后台追踪仓库提交，并在填写了需求 ID 时把提交记录同步到当前团队。切换页面或重启应用后，监控会继续。
          <MonitorFields
            form={form}
            setForm={setForm}
            requirements={requirements}
            requirementsNote={requirementsNote}
            hasToken={false}
            radioName="git-branch-add"
            showClearToken={false}
            onError={setError}
          />
          <button className="btn" onClick={handleAdd} disabled={submitting || !form.location.trim()}>
            {submitting && !editingId ? '正在检查仓库…' : '添加仓库'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">当前监控的仓库 ({teamMonitors.length})</div>
        <div className="card-content">
          {listError && <ErrorBanner message={listError} />}
          {teamMonitors.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>暂无监控的仓库</p>
          ) : (
            teamMonitors.map((monitor) => {
              const connection = connections.find((item) => item.id === monitor.connectionId);
              const requirement = requirements.find((item) => item.id === monitor.requirementId);
              if (editingId === monitor.id) {
                return (
                  <div key={monitor.id} style={rowStyle}>
                    <MonitorFields
                      form={editing}
                      setForm={setEditing}
                      requirements={requirements}
                      requirementsNote={requirementsNote}
                      hasToken={editingHasToken}
                      radioName={`git-branch-${monitor.id}`}
                      showClearToken={editingHasToken}
                      onError={setError}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn" onClick={handleSave} disabled={submitting || !editing.location.trim()}>
                        {submitting ? '正在保存…' : '保存'}
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setEditingId(null)}
                        disabled={submitting}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={monitor.id} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, wordBreak: 'break-all' }}>{monitor.path}</div>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {kindLabel(monitor.kind)} | {branchLabel(monitor)} | 团队: {connection?.teamName || '当前团队'} | 需求:{' '}
                      {requirement?.title || monitor.requirementId || '未关联'}
                    </div>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {monitor.lastError ? '读取失败' : '监控中'}
                      {monitor.lastCommit
                        ? ` | 最近提交: ${monitor.lastCommit.slice(0, 7)} ${monitor.lastSubject ?? ''}`
                        : ''}
                    </div>
                    {monitor.lastError && (
                      <div style={{ color: '#a12622', marginTop: '6px', wordBreak: 'break-word' }}>{monitor.lastError}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button className="btn btn-secondary" onClick={() => startEdit(monitor)} style={smallButton}>
                      编辑
                    </button>
                    <button className="btn btn-secondary" onClick={() => handleRemove(monitor)} style={smallButton}>
                      移除
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function MonitorFields({
  form,
  setForm,
  requirements,
  requirementsNote,
  hasToken,
  radioName,
  showClearToken,
  onError,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  requirements: RequirementOption[];
  requirementsNote: string;
  hasToken: boolean;
  radioName: string;
  showClearToken: boolean;
  onError: (message: string) => void;
}) {
  const patch = (partial: Partial<FormState>) => setForm({ ...form, ...partial });
  const selectedRequirement = requirements.some((item) => item.id === form.requirementId)
    ? form.requirementId
    : '';

  const chooseFolder = async () => {
    try {
      const folder = await pickRepositoryFolder();
      if (folder) patch({ location: folder });
    } catch (pickerError) {
      onError(`选择文件夹失败：${formatInvokeError(pickerError)}`);
    }
  };

  return (
    <div style={{ marginTop: '16px' }}>
      <div className="form-group">
        <label>仓库路径或远程地址 *</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="本地文件夹、\\\\wsl$\\发行版\\路径，或 https://github.com/org/repo"
            value={form.location}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => patch({ location: event.target.value })}
            style={{ flex: 1, minWidth: 0, width: 'auto' }}
          />
          <button type="button" className="btn btn-secondary" onClick={chooseFolder} style={{ whiteSpace: 'nowrap' }}>
            选择文件夹
          </button>
        </div>
        <small style={hintStyle}>
          可手动输入，或用系统文件夹选择器。Windows 支持 \\wsl$\ 和 \\wsl.localhost\ 路径，这类路径会定时通过 wsl.exe 检查。远程地址支持公开仓库，以及使用本机 Git 凭据、SSH 密钥或访问令牌的私有仓库。
        </small>
      </div>

      <div className="form-group">
        <label>分支</label>
        <label style={radioStyle}>
          <input
            type="radio"
            name={radioName}
            checked={form.followBranch}
            onChange={() => patch({ followBranch: true })}
            style={radioInputStyle}
          />
          跟随当前分支
        </label>
        <label style={radioStyle}>
          <input
            type="radio"
            name={radioName}
            checked={!form.followBranch}
            onChange={() => patch({ followBranch: false })}
            style={radioInputStyle}
          />
          指定分支
        </label>
        {!form.followBranch && (
          <input
            type="text"
            placeholder="main 或 feature/login"
            value={form.branch}
            onChange={(event) => patch({ branch: event.target.value })}
            style={{ marginTop: '8px' }}
          />
        )}
        <small style={hintStyle}>
          默认跟随当前检出的分支，切换分支后会自动更新。远程仓库则跟随其默认分支。也可以固定一个分支，之后随时修改。
        </small>
      </div>

      <div className="form-group">
        <label>关联需求 ID</label>
        {requirements.length > 0 && (
          <select
            value={selectedRequirement}
            onChange={(event) => patch({ requirementId: event.target.value })}
            style={{ marginBottom: '8px' }}
          >
            <option value="">不关联需求</option>
            {requirements.map((requirement) => (
              <option key={requirement.id} value={requirement.id}>
                {requirement.title}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="可选，粘贴需求 UUID"
          value={form.requirementId}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => patch({ requirementId: event.target.value })}
        />
        <small style={hintStyle}>
          可选。填写后，新的提交会同步到该需求；留空则只在本机记录。{requirementsNote ? ` ${requirementsNote}` : ''}
        </small>
      </div>

      <div className="form-group">
        <label>访问令牌</label>
        <input
          type="password"
          placeholder={hasToken ? '已保存在本机，留空则不修改' : '可选，仅用于私有 HTTPS 仓库'}
          value={form.accessToken}
          autoComplete="off"
          onChange={(event) => patch({ accessToken: event.target.value, clearToken: false })}
        />
        {showClearToken && (
          <label style={{ ...radioStyle, marginTop: '8px' }}>
            <input
              type="checkbox"
              checked={form.clearToken}
              onChange={(event) => patch({ clearToken: event.target.checked, accessToken: '' })}
              style={radioInputStyle}
            />
            清除已保存的令牌
          </label>
        )}
        <small style={hintStyle}>
          可选。令牌只保存在本机系统钥匙串；钥匙串不可用时写入本地配置。它不会发送到团队服务器，也不会写入日志。留空则使用本机已有的 Git 凭据或 SSH 密钥。
        </small>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        background: '#fdecea',
        color: '#a12622',
        border: '1px solid #f5c2c0',
        borderRadius: '8px',
        padding: '10px 12px',
        marginTop: '12px',
      }}
    >
      {message}
    </div>
  );
}

function kindLabel(kind: string): string {
  if (kind === 'wsl') return 'WSL';
  if (kind === 'remote') return '远程';
  return '本地';
}

function branchLabel(monitor: GitMonitor): string {
  if (monitor.branchMode === 'pin') {
    return `固定分支 ${monitor.branch || ''}`;
  }
  return monitor.currentBranch ? `跟随当前分支（当前 ${monitor.currentBranch}）` : '跟随当前分支';
}

const hintStyle = {
  color: 'var(--text-secondary)',
  marginTop: '4px',
  display: 'block',
};

const radioStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontWeight: 400,
  marginBottom: '6px',
};

const radioInputStyle = { width: 'auto' };

const rowStyle = {
  padding: '12px',
  backgroundColor: 'var(--bg-secondary)',
  borderRadius: '6px',
  marginBottom: '8px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
};

const smallButton = { fontSize: '14px', padding: '6px 12px' };

export default GitMonitorSettings;
