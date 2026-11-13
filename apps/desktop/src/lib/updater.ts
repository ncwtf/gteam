import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

export type UpdateCheck =
  | { status: 'update'; update: Update }
  | { status: 'latest' }
  | { status: 'unavailable' };

export type UpdateProgress = {
  phase: 'downloading' | 'installing' | 'relaunching';
  percent: number | null;
};

export function formatVersion(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

export function formatProgress(progress: UpdateProgress): string {
  if (progress.phase === 'downloading') {
    return progress.percent === null ? '正在下载...' : `正在下载 ${progress.percent}%`;
  }
  if (progress.phase === 'installing') return '正在安装...';
  return '正在重启...';
}

function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getCurrentVersion(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  try {
    return await getVersion();
  } catch (error) {
    console.warn('读取版本失败', error);
    return null;
  }
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!isDesktopApp()) return { status: 'unavailable' };
  try {
    const update = await check();
    return update ? { status: 'update', update } : { status: 'latest' };
  } catch (error) {
    console.warn('检查更新失败', error);
    return { status: 'unavailable' };
  }
}

const listeners = new Set<(progress: UpdateProgress) => void>();
let installPromise: Promise<void> | null = null;

function emit(progress: UpdateProgress) {
  for (const listener of listeners) listener(progress);
}

async function runInstall(update: Update): Promise<void> {
  let downloaded = 0;
  let total = 0;
  emit({ phase: 'downloading', percent: null });
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? 0;
        downloaded = 0;
        emit({ phase: 'downloading', percent: total > 0 ? 0 : null });
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        emit({
          phase: 'downloading',
          percent: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
        });
        break;
      case 'Finished':
        emit({ phase: 'installing', percent: null });
        break;
    }
  });
  emit({ phase: 'relaunching', percent: null });
  await relaunch();
}

export function installAndRelaunch(
  update: Update,
  onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
  listeners.add(onProgress);
  if (!installPromise) {
    installPromise = runInstall(update).catch((error: unknown) => {
      installPromise = null;
      throw error;
    });
  }
  return installPromise.finally(() => {
    listeners.delete(onProgress);
  });
}
