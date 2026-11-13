import { homeDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { platform } from '@tauri-apps/plugin-os';
import type { TeamConnection } from '@gteam/shared';
import {
  claudeCodeStatus,
  codeBuddyStatus,
  codeBuddyWritePath,
  codexStatus,
  commandPaths,
  ideTargets,
  jsonStatus,
  mcpEntry,
  normalizeEntry,
  parentDir,
  readCodexGteam,
  removeClaudeConfig,
  removeCodexConfig,
  removeJsonMcp,
  teamsForMcp,
  upsertClaudeConfig,
  upsertCodexConfig,
  upsertJsonMcp,
  type CodeBuddyFile,
  type DesktopOs,
  type ExpectedMcpConfig,
  type IdeConfigStatus,
  type IdeId,
  type IdeTarget,
  type McpLaunch,
  type McpServerEntry,
} from './ideConfigCore';

export type { IdeConfigStatus, IdeId, IdeTarget };

export interface IdeInspection extends IdeTarget {
  status: IdeConfigStatus;
  configPath: string;
}

function desktopOs(value: string): DesktopOs {
  if (value === 'windows' || value === 'macos' || value === 'linux') return value;
  return 'linux';
}

async function currentOs(): Promise<DesktopOs> {
  return desktopOs(platform());
}

export async function resolveMcpLaunch(): Promise<McpLaunch> {
  if (inTauri()) {
    try {
      const command = await invoke<string>('mcp_server_path');
      if (command) return { command, args: [] };
    } catch (error) {
      if (!import.meta.env.DEV) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message || '未找到随应用安装的 MCP 程序');
      }
    }
  }
  if (import.meta.env.DEV) {
    const home = (await homeDir()).replace(/[\\/]+$/, '');
    const sep = home.includes('\\') ? '\\' : '/';
    return {
      command: 'node',
      args: [`${home}${sep}gteam${sep}packages${sep}mcp-server${sep}dist${sep}cli.js`],
    };
  }
  throw new Error('未找到随应用安装的 MCP 程序，请重新安装 gteam');
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function pathExists(filePath: string): Promise<boolean> {
  if (!filePath) return false;
  if (inTauri()) {
    try {
      const [existsOnDisk] = await invoke<boolean[]>('paths_exist', { paths: [filePath] });
      return Boolean(existsOnDisk);
    } catch {
      // Fall through to the fs plugin for paths inside the home scope.
    }
  }
  try {
    return await exists(filePath);
  } catch {
    return false;
  }
}

async function pathExistsMap(paths: string[]): Promise<(filePath: string) => boolean> {
  const unique = [...new Set(paths)];
  const found = new Map<string, boolean>();
  if (unique.length === 0) return () => false;
  if (inTauri()) {
    try {
      const flags = await invoke<boolean[]>('paths_exist', { paths: unique });
      unique.forEach((filePath, index) => found.set(filePath, Boolean(flags[index])));
      return (filePath) => found.get(filePath) ?? false;
    } catch {
      // checked one by one below
    }
  }
  await Promise.all(
    unique.map(async (filePath) => {
      found.set(filePath, await pathExists(filePath));
    }),
  );
  return (filePath) => found.get(filePath) ?? false;
}

async function readIfExists(filePath: string): Promise<string | null> {
  if (!(await exists(filePath))) return null;
  return readTextFile(filePath);
}

function expectedConfig(connections: TeamConnection[], activeConnectionId: string | null, launch: McpLaunch): ExpectedMcpConfig {
  const { teams, defaultTeam } = teamsForMcp(connections, activeConnectionId);
  return { launch, teams, defaultTeam };
}

function entryFor(connections: TeamConnection[], activeConnectionId: string | null, launch: McpLaunch): McpServerEntry {
  const { teams, defaultTeam } = teamsForMcp(connections, activeConnectionId);
  return mcpEntry(launch, teams, defaultTeam);
}

export async function inspectIdes(
  connections: TeamConnection[],
  activeConnectionId: string | null,
): Promise<IdeInspection[]> {
  const os = await currentOs();
  const home = await homeDir();
  const targets = ideTargets(os, home);
  let launch: McpLaunch | null = null;
  try {
    launch = await resolveMcpLaunch();
  } catch {
    launch = null;
  }
  const expected = launch
    ? expectedConfig(connections, activeConnectionId, launch)
    : expectedConfig(connections, activeConnectionId, { command: '', args: [] });

  const inspections: IdeInspection[] = [];
  for (const target of targets) {
    const files = await Promise.all(
      target.paths.map(async (filePath) => ({
        path: filePath,
        exists: await exists(filePath).catch(() => false),
        text: null as string | null,
      })),
    );
    for (const file of files) {
      if (file.exists) file.text = await readTextFile(file.path);
    }
    const texts = files.map((file) => file.text ?? '');
    const pathArgs = collectCommandPaths(target.id, files.map((file) => (file.exists ? file.text : null)));
    const existsAt = await pathExistsMap(pathArgs);
    let status: IdeConfigStatus = 'unconfigured';
    if (!launch) {
      status = texts.some((text) => text.includes('"gteam"') || text.includes('mcp_servers.gteam'))
        ? 'needs_repair'
        : 'unconfigured';
    } else if (target.id === 'claude-code') {
      status = claudeCodeStatus(files[0].exists ? files[0].text : null, expected, existsAt);
    } else if (target.id === 'codex') {
      status = codexStatus(files[0].exists ? files[0].text : null, expected, existsAt);
    } else if (target.id === 'codebuddy') {
      status = codeBuddyStatus(files, expected, existsAt);
    } else {
      status = jsonStatus(files[0].exists ? files[0].text : null, expected, existsAt);
    }
    const configPath = target.id === 'codebuddy' ? codeBuddyWritePath(files) : target.paths[0];
    inspections.push({ ...target, status, configPath });
  }
  return inspections;
}

function collectCommandPaths(id: IdeId, texts: Array<string | null>): string[] {
  const paths: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    try {
      if (id === 'codex') {
        const entry = readCodexGteam(text);
        if (entry) paths.push(...commandPaths(entry));
        continue;
      }
      const doc = JSON.parse(text) as { mcpServers?: { gteam?: unknown }; projects?: Record<string, { mcpServers?: { gteam?: unknown } }> };
      const entries = [normalizeEntry(doc?.mcpServers?.gteam)];
      for (const project of Object.values(doc?.projects ?? {})) {
        entries.push(normalizeEntry(project?.mcpServers?.gteam));
      }
      for (const entry of entries) {
        if (entry) paths.push(...commandPaths(entry));
      }
    } catch {
      // The status helpers report a file that cannot be parsed.
    }
  }
  return paths;
}

async function writeConfig(filePath: string, contents: string): Promise<void> {
  await mkdir(parentDir(filePath), { recursive: true });
  await writeTextFile(filePath, contents);
}

export async function configureIde(
  id: IdeId,
  connections: TeamConnection[],
  activeConnectionId: string | null,
): Promise<{ success: boolean; message: string }> {
  if (connections.length === 0) {
    return { success: false, message: '请先添加团队，再配置 IDE' };
  }
  try {
    const launch = await resolveMcpLaunch();
    const entry = entryFor(connections, activeConnectionId, launch);
    const os = await currentOs();
    const home = await homeDir();
    const target = ideTargets(os, home).find((item) => item.id === id);
    if (!target) return { success: false, message: '未知的 IDE' };

    if (id === 'codebuddy') {
      const files: CodeBuddyFile[] = await Promise.all(
        target.paths.map(async (filePath) => ({
          path: filePath,
          exists: await exists(filePath).catch(() => false),
          text: null,
        })),
      );
      for (const file of files) {
        if (file.exists) file.text = await readTextFile(file.path);
      }
      const destination = codeBuddyWritePath(files);
      const current = files.find((file) => file.path === destination);
      await writeConfig(destination, upsertJsonMcp(current?.exists ? current.text : null, entry));
      for (const file of files) {
        if (file.path === destination || !file.exists || file.text === null) continue;
        if (!file.text.includes('"gteam"')) continue;
        await writeConfig(file.path, removeJsonMcp(file.text));
      }
      return { success: true, message: `已写入 ${destination}` };
    }

    const filePath = target.paths[0];
    const current = await readIfExists(filePath);
    const next =
      id === 'claude-code'
        ? upsertClaudeConfig(current, entry)
        : id === 'codex'
          ? upsertCodexConfig(current, entry)
          : upsertJsonMcp(current, entry);
    await writeConfig(filePath, next);
    return { success: true, message: `已写入 ${filePath}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `写入失败: ${message}` };
  }
}

export async function removeIde(id: IdeId): Promise<{ success: boolean; message: string }> {
  try {
    const os = await currentOs();
    const home = await homeDir();
    const target = ideTargets(os, home).find((item) => item.id === id);
    if (!target) return { success: false, message: '未知的 IDE' };
    let removed = 0;
    for (const filePath of target.paths) {
      if (!(await exists(filePath).catch(() => false))) continue;
      const current = await readTextFile(filePath);
      const hasGteam =
        id === 'codex'
          ? /\[mcp_servers\.gteam(?:[.\]])/.test(current)
          : current.includes('"gteam"');
      if (!hasGteam) continue;
      const next =
        id === 'claude-code'
          ? removeClaudeConfig(current)
          : id === 'codex'
            ? removeCodexConfig(current)
            : removeJsonMcp(current);
      await writeTextFile(filePath, next);
      removed += 1;
    }
    if (removed === 0) return { success: true, message: `${target.name} 里没有 gteam 配置` };
    return { success: true, message: `已从 ${target.name} 移除 gteam` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `移除失败: ${message}` };
  }
}

export async function copyIdeConfig(
  id: IdeId,
  connections: TeamConnection[],
  activeConnectionId: string | null,
): Promise<void> {
  const launch = await resolveMcpLaunch();
  const entry = entryFor(connections, activeConnectionId, launch);
  const snippet =
    id === 'codex'
      ? upsertCodexConfig('', entry)
      : JSON.stringify({ mcpServers: { gteam: entry } }, null, 2);
  await navigator.clipboard.writeText(snippet);
}

export function statusLabel(status: IdeConfigStatus): string {
  if (status === 'configured') return '已配置';
  if (status === 'needs_repair') return '需要修复';
  return '未配置';
}
