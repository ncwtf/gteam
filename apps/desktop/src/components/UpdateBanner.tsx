import { useEffect, useState } from 'react';
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

  if (!update) return null;

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
