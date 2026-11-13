import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { Update } from '@tauri-apps/plugin-updater';
import {
  checkForUpdate,
  formatProgress,
  formatVersion,
  installAndRelaunch,
  type UpdateProgress,
} from '../lib/updater';

function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then((result) => {
      if (!cancelled && result.status === 'update') {
        setUpdate(result.update);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 托盘菜单「检查更新」
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen('tray-check-update', async () => {
      setNotice('正在检查更新...');
      const result = await checkForUpdate();
      if (result.status === 'update') {
        setUpdate(result.update);
        setNotice('');
      } else {
        setNotice(result.status === 'latest' ? '已是最新版本' : '暂时无法检查更新');
        setTimeout(() => setNotice(''), 4000);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!update) {
    return notice ? (
      <div className="update-banner" role="status" aria-live="polite">
        <span>{notice}</span>
      </div>
    ) : null;
  }

  const onUpdate = () => {
    setFailed(false);
    installAndRelaunch(update, setProgress).catch((error: unknown) => {
      console.warn('安装更新失败', error);
      setProgress(null);
      setFailed(true);
    });
  };

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span>
        发现新版本 {formatVersion(update.version)}
        {progress ? ` · ${formatProgress(progress)}` : ''}
        {failed ? ' · 更新失败' : ''}
      </span>
      <button
        className="btn"
        onClick={onUpdate}
        disabled={progress !== null}
        style={{ padding: '6px 12px' }}
      >
        立即更新
      </button>
    </div>
  );
}

export default UpdateBanner;
