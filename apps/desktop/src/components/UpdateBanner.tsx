import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { Update } from '@tauri-apps/plugin-updater';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import {
  checkForUpdate,
  formatProgress,
  formatVersion,
  installAndRelaunch,
  type UpdateProgress,
} from '../lib/updater';

async function notify(body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }
    if (granted) sendNotification({ title: 'gteam', body });
  } catch (error) {
    console.warn('通知失败', error);
  }
}

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

    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!inTauri) {
      return () => {
        cancelled = true;
      };
    }

    const unlistenPromise = listen('gteam-check-update', async () => {
      const result = await checkForUpdate();
      if (result.status === 'latest') {
        setUpdate(null);
        await notify('已是最新版本');
      } else if (result.status === 'update') {
        setUpdate(result.update);
        await notify(`发现新版本 ${formatVersion(result.update.version)}`);
      } else {
        await notify('暂时无法检查更新');
      }
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
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
