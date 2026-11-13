import { parse as parseToml } from 'smol-toml';
import type { TeamConnection } from '@gteam/shared';

export type DesktopOs = 'macos' | 'windows' | 'linux';
export type IdeId = 'cursor' | 'claude-code' | 'codex' | 'codebuddy';
export type IdeConfigStatus = 'unconfigured' | 'configured' | 'needs_repair';

export interface McpTeam {
  serverUrl: string;
  token: string;
  teamName: string;
}

export interface McpLaunch {
  command: string;
  args: string[];
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ExpectedMcpConfig {
  launch: McpLaunch;
  teams: McpTeam[];
  defaultTeam: string;
}

export interface IdeTarget {
  id: IdeId;
  name: string;
  description: string;
  /** Files this IDE reads, highest priority first. */
  paths: string[];
}

const CODEBUDDY_RELATIVE = [
  ['.codebuddy', '.mcp.json'],
  ['.codebuddy', 'mcp.json'],
  ['.codebuddy.json'],
] as const;

export function joinHome(home: string, os: DesktopOs, ...parts: string[]): string {
  const sep = os === 'windows' ? '\\' : '/';
  return [home.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

export function parentDir(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/';
  const idx = filePath.lastIndexOf(sep);
  return idx > 0 ? filePath.slice(0, idx) : filePath;
}

/** User-level config files. CodeBuddy keeps several historical names. */
export function ideTargets(os: DesktopOs, home: string): IdeTarget[] {
  return [
    {
      id: 'cursor',
      name: 'Cursor',
      description: '用户级 MCP 配置，写入 mcpServers.gteam',
      paths: [joinHome(home, os, '.cursor', 'mcp.json')],
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      description: '用户级配置 ~/.claude.json 的 mcpServers，对所有项目生效',
      paths: [joinHome(home, os, '.claude.json')],
    },
    {
      id: 'codex',
      name: 'Codex',
      description: '用户级 ~/.codex/config.toml 的 [mcp_servers.gteam]',
      paths: [joinHome(home, os, '.codex', 'config.toml')],
    },
    {
      id: 'codebuddy',
      name: 'CodeBuddy',
      description: '优先 ~/.codebuddy/.mcp.json，已有旧文件时改那个文件',
      paths: CODEBUDDY_RELATIVE.map((parts) => joinHome(home, os, ...parts)),
    },
  ];
}

export function teamsForMcp(
  connections: TeamConnection[],
  activeConnectionId: string | null,
): { teams: McpTeam[]; defaultTeam: string } {
  const teams = connections.map((connection) => ({
    serverUrl: connection.serverUrl.replace(/\/+$/, ''),
    token: connection.token,
    teamName: connection.teamName || '',
  }));
  const active =
    connections.find((connection) => connection.id === activeConnectionId) ??
    connections.find((connection) => connection.isActive) ??
    connections[0];
  return {
    teams,
    defaultTeam: active?.teamName || active?.serverUrl.replace(/\/+$/, '') || '',
  };
}

export function mcpEntry(launch: McpLaunch, teams: McpTeam[], defaultTeam: string): McpServerEntry {
  return {
    command: launch.command,
    args: [...launch.args],
    env: {
      GTEAM_TEAMS: JSON.stringify(teams),
      GTEAM_DEFAULT_TEAM: defaultTeam,
    },
  };
}

function isFilePath(value: string): boolean {
  if (!value || value.startsWith('-')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith('/') || value.startsWith('\\') || value.startsWith('~')) return true;
  if (value.includes('/') || value.includes('\\')) return true;
  return /\.(js|cjs|mjs|exe)$/i.test(value);
}

export function commandPaths(entry: { command?: string; args?: string[] }): string[] {
  const paths: string[] = [];
  if (entry.command && isFilePath(entry.command)) paths.push(entry.command);
  for (const arg of entry.args ?? []) {
    if (isFilePath(arg)) paths.push(arg);
  }
  return paths;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string' && value) return [value];
  return [];
}

function asEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined || item === null) continue;
    env[key] = String(item);
  }
  return env;
}

export function normalizeEntry(value: unknown): McpServerEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.command !== 'string' || !record.command) return null;
  return {
    command: record.command,
    args: asStringArray(record.args),
    env: asEnv(record.env),
  };
}

function teamKey(team: { serverUrl?: string; token?: string; teamName?: string }): string {
  return JSON.stringify({
    serverUrl: String(team.serverUrl ?? '').replace(/\/+$/, ''),
    token: String(team.token ?? ''),
    teamName: String(team.teamName ?? ''),
  });
}

function teamsMatch(entry: McpServerEntry, expected: ExpectedMcpConfig): boolean {
  const raw = entry.env.GTEAM_TEAMS;
  if (!raw) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed)) return false;
  const actual = parsed.map((team) => teamKey(team as McpTeam)).sort();
  const wanted = expected.teams.map((team) => teamKey(team)).sort();
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) {
    return false;
  }
  return (entry.env.GTEAM_DEFAULT_TEAM ?? '') === expected.defaultTeam;
}

export function entryStatus(
  entry: McpServerEntry | null,
  expected: ExpectedMcpConfig,
  pathExists: (path: string) => boolean,
): IdeConfigStatus {
  if (!entry) return 'unconfigured';
  const paths = commandPaths(entry);
  if (paths.some((filePath) => !pathExists(filePath))) return 'needs_repair';
  if (!teamsMatch(entry, expected)) return 'needs_repair';
  return 'configured';
}

function parseJsonObject(raw: string | null): Record<string, any> | null {
  if (raw === null) return null;
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('配置文件不是 JSON 对象');
  }
  return parsed;
}

export function readJsonGteam(raw: string | null): McpServerEntry | null {
  const doc = parseJsonObject(raw);
  if (!doc) return null;
  return normalizeEntry(doc.mcpServers?.gteam);
}

function stringifyJson(doc: Record<string, unknown>): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function upsertJsonMcp(raw: string | null, entry: McpServerEntry): string {
  const doc = parseJsonObject(raw) ?? {};
  if (!doc.mcpServers || typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers)) {
    doc.mcpServers = {};
  }
  doc.mcpServers.gteam = entry;
  return stringifyJson(doc);
}

export function removeJsonMcp(raw: string): string {
  const doc = parseJsonObject(raw);
  if (!doc?.mcpServers || typeof doc.mcpServers !== 'object') return raw.endsWith('\n') ? raw : `${raw}\n`;
  delete doc.mcpServers.gteam;
  if (Object.keys(doc.mcpServers).length === 0) delete doc.mcpServers;
  return stringifyJson(doc);
}

function claudeProjectEntries(doc: Record<string, any>): McpServerEntry[] {
  if (!doc.projects || typeof doc.projects !== 'object') return [];
  const entries: McpServerEntry[] = [];
  for (const project of Object.values(doc.projects as Record<string, any>)) {
    const entry = normalizeEntry(project?.mcpServers?.gteam);
    if (entry) entries.push(entry);
  }
  return entries;
}

function stripClaudeProjectGteam(doc: Record<string, any>) {
  if (!doc.projects || typeof doc.projects !== 'object') return;
  for (const project of Object.values(doc.projects as Record<string, any>)) {
    if (!project?.mcpServers || typeof project.mcpServers !== 'object') continue;
    delete project.mcpServers.gteam;
    if (Object.keys(project.mcpServers).length === 0) delete project.mcpServers;
  }
}

/** User-scope entry only counts as configured when nothing in a project shadows it. */
export function claudeCodeStatus(
  raw: string | null,
  expected: ExpectedMcpConfig,
  pathExists: (path: string) => boolean,
): IdeConfigStatus {
  if (raw === null) return 'unconfigured';
  let doc: Record<string, any>;
  try {
    const parsed = parseJsonObject(raw);
    if (!parsed) return 'unconfigured';
    doc = parsed;
  } catch {
    return 'needs_repair';
  }
  const top = normalizeEntry(doc.mcpServers?.gteam);
  const shadowed = claudeProjectEntries(doc);
  if (!top && shadowed.length === 0) return 'unconfigured';
  if (!top || shadowed.length > 0) return 'needs_repair';
  return entryStatus(top, expected, pathExists);
}

export function upsertClaudeConfig(raw: string | null, entry: McpServerEntry): string {
  const doc = parseJsonObject(raw) ?? {};
  if (!doc.mcpServers || typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers)) {
    doc.mcpServers = {};
  }
  doc.mcpServers.gteam = entry;
  stripClaudeProjectGteam(doc);
  return stringifyJson(doc);
}

export function removeClaudeConfig(raw: string): string {
  const doc = parseJsonObject(raw);
  if (!doc) return raw;
  if (doc.mcpServers && typeof doc.mcpServers === 'object') {
    delete doc.mcpServers.gteam;
    if (Object.keys(doc.mcpServers).length === 0) delete doc.mcpServers;
  }
  stripClaudeProjectGteam(doc);
  return stringifyJson(doc);
}

export interface CodeBuddyFile {
  path: string;
  exists: boolean;
  text: string | null;
}

export function codeBuddyWritePath(files: CodeBuddyFile[]): string {
  return files.find((file) => file.exists)?.path ?? files[0].path;
}

export function codeBuddyStatus(
  files: CodeBuddyFile[],
  expected: ExpectedMcpConfig,
  pathExists: (path: string) => boolean,
): IdeConfigStatus {
  const existing = files.filter((file) => file.exists);
  if (existing.length === 0) return 'unconfigured';
  let effective: IdeConfigStatus;
  try {
    effective = entryStatus(readJsonGteam(existing[0].text), expected, pathExists);
  } catch {
    return 'needs_repair';
  }
  const shadowHasGteam = existing.slice(1).some((file) => {
    try {
      return readJsonGteam(file.text) !== null;
    } catch {
      return file.text?.includes('gteam') ?? false;
    }
  });
  if (effective === 'unconfigured' && shadowHasGteam) return 'needs_repair';
  if (effective === 'configured' && shadowHasGteam) return 'needs_repair';
  return effective;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function tomlString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

/** Drop [mcp_servers.gteam] and nested tables such as [mcp_servers.gteam.env]. */
export function removeTomlTable(source: string, tableName: string): string {
  const header = new RegExp(`^\\s*\\[${escapeRegExp(tableName)}(?:\\.[^\\]]*)?\\]\\s*(?:#.*)?$`);
  const anyHeader = /^\s*\[/;
  const kept: string[] = [];
  let skipping = false;
  for (const line of source.split(/\r?\n/)) {
    if (skipping) {
      if (anyHeader.test(line) && !header.test(line)) {
        skipping = false;
        kept.push(line);
      }
      continue;
    }
    if (header.test(line)) {
      skipping = true;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s*$/, '');
}

export function renderGteamToml(entry: McpServerEntry): string {
  const args = entry.args.map((arg) => tomlString(arg)).join(', ');
  return [
    '[mcp_servers.gteam]',
    `command = ${tomlString(entry.command)}`,
    `args = [${args}]`,
    '',
    '[mcp_servers.gteam.env]',
    `GTEAM_TEAMS = ${tomlString(entry.env.GTEAM_TEAMS ?? '')}`,
    `GTEAM_DEFAULT_TEAM = ${tomlString(entry.env.GTEAM_DEFAULT_TEAM ?? '')}`,
    '',
  ].join('\n');
}

export function upsertCodexConfig(existing: string | null, entry: McpServerEntry): string {
  const stripped = removeTomlTable(existing ?? '', 'mcp_servers.gteam');
  const base = stripped.replace(/\s*$/, '');
  if (base.trim()) parseToml(base);
  return `${base ? `${base}\n\n` : ''}${renderGteamToml(entry)}`;
}

export function removeCodexConfig(existing: string): string {
  const stripped = removeTomlTable(existing, 'mcp_servers.gteam').replace(/\s*$/, '');
  return stripped ? `${stripped}\n` : '';
}

export function readCodexGteam(raw: string | null): McpServerEntry | null {
  if (raw === null || !raw.trim()) return null;
  const doc = parseToml(raw) as Record<string, any>;
  return normalizeEntry(doc.mcp_servers?.gteam);
}

export function codexStatus(
  raw: string | null,
  expected: ExpectedMcpConfig,
  pathExists: (path: string) => boolean,
): IdeConfigStatus {
  if (raw === null || !raw.trim()) return 'unconfigured';
  try {
    const entry = readCodexGteam(raw);
    if (!entry) return 'unconfigured';
    return entryStatus(entry, expected, pathExists);
  } catch {
    return 'needs_repair';
  }
}

export function jsonStatus(
  raw: string | null,
  expected: ExpectedMcpConfig,
  pathExists: (path: string) => boolean,
): IdeConfigStatus {
  if (raw === null) return 'unconfigured';
  try {
    return entryStatus(readJsonGteam(raw), expected, pathExists);
  } catch {
    return 'needs_repair';
  }
}
