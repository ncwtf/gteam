import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeamConnection } from '@gteam/shared';
import {
  claudeCodeStatus,
  codeBuddyStatus,
  codeBuddyWritePath,
  codexStatus,
  commandPaths,
  entryStatus,
  ideTargets,
  jsonStatus,
  mcpEntry,
  readCodexGteam,
  removeClaudeConfig,
  removeCodexConfig,
  removeJsonMcp,
  teamsForMcp,
  upsertClaudeConfig,
  upsertCodexConfig,
  upsertJsonMcp,
  type ExpectedMcpConfig,
  type McpServerEntry,
} from '../src/lib/ideConfigCore.ts';

function connection(partial: Partial<TeamConnection> & Pick<TeamConnection, 'id' | 'serverUrl' | 'teamName'>): TeamConnection {
  return {
    token: 'token',
    userId: 'u',
    userName: 'n',
    isActive: false,
    joinedAt: new Date(),
    ...partial,
  };
}

const launch = { command: 'C:\\Program Files\\gteam\\gteam-mcp.exe', args: [] as string[] };
const teams = teamsForMcp(
  [
    connection({ id: '1', serverUrl: 'http://192.168.1.200:3000', teamName: 'qkk.local', token: 'a', isActive: true }),
    connection({ id: '2', serverUrl: 'http://101.35.25.236:20180/', teamName: 'mat', token: 'b' }),
    connection({ id: '3', serverUrl: 'http://s2.qikangkang.com:18010', teamName: 'gteam', token: 'c' }),
  ],
  '1',
);
const entry = mcpEntry(launch, teams.teams, teams.defaultTeam);
const expected: ExpectedMcpConfig = { launch, teams: teams.teams, defaultTeam: teams.defaultTeam };
const present = () => true;
const missingScript = (filePath: string) => !filePath.includes('dist\\cli.js') && !filePath.includes('dist/cli.js');

test('config paths follow each IDE on macOS, Windows, and Linux', () => {
  const mac = Object.fromEntries(ideTargets('macos', '/Users/hunter').map((ide) => [ide.id, ide.paths]));
  const win = Object.fromEntries(ideTargets('windows', 'C:\\Users\\hunter').map((ide) => [ide.id, ide.paths]));
  const linux = Object.fromEntries(ideTargets('linux', '/home/hunter').map((ide) => [ide.id, ide.paths]));

  assert.deepEqual(mac.cursor, ['/Users/hunter/.cursor/mcp.json']);
  assert.deepEqual(mac['claude-code'], ['/Users/hunter/.claude.json']);
  assert.deepEqual(mac.codex, ['/Users/hunter/.codex/config.toml']);
  assert.deepEqual(mac.codebuddy, [
    '/Users/hunter/.codebuddy/.mcp.json',
    '/Users/hunter/.codebuddy/mcp.json',
    '/Users/hunter/.codebuddy.json',
  ]);

  assert.deepEqual(win.cursor, ['C:\\Users\\hunter\\.cursor\\mcp.json']);
  assert.deepEqual(win['claude-code'], ['C:\\Users\\hunter\\.claude.json']);
  assert.deepEqual(win.codex, ['C:\\Users\\hunter\\.codex\\config.toml']);
  assert.equal(win.codebuddy[0], 'C:\\Users\\hunter\\.codebuddy\\.mcp.json');

  assert.deepEqual(linux.cursor, ['/home/hunter/.cursor/mcp.json']);
  assert.deepEqual(linux.codex, ['/home/hunter/.codex/config.toml']);
});

test('cursor merge updates gteam and keeps other servers', () => {
  const original = JSON.stringify(
    {
      mcpServers: {
        other: { command: 'npx', args: ['-y', 'other'] },
        gteam: {
          command: 'node',
          args: ['C:\\Users\\hunter\\gteam\\packages\\mcp-server\\dist\\cli.js'],
          env: { GTEAM_TEAMS: '[]', GTEAM_DEFAULT_TEAM: '' },
        },
      },
    },
    null,
    2,
  );
  const once = upsertJsonMcp(original, entry);
  const twice = upsertJsonMcp(once, entry);
  const parsed = JSON.parse(twice);
  assert.deepEqual(Object.keys(parsed.mcpServers), ['other', 'gteam']);
  assert.equal(parsed.mcpServers.other.command, 'npx');
  assert.equal(parsed.mcpServers.gteam.command, launch.command);
  assert.equal(JSON.parse(twice).mcpServers.gteam.args.length, 0);
  const names = Object.keys(JSON.parse(twice).mcpServers).filter((name) => name === 'gteam');
  assert.equal(names.length, 1);

  const removed = JSON.parse(removeJsonMcp(twice));
  assert.deepEqual(Object.keys(removed.mcpServers), ['other']);
});

test('status is unconfigured, configured, or needs repair', () => {
  assert.equal(jsonStatus(null, expected, present), 'unconfigured');
  assert.equal(jsonStatus(JSON.stringify({ mcpServers: { other: { command: 'npx' } } }), expected, present), 'unconfigured');

  const broken = upsertJsonMcp(null, {
    command: 'node',
    args: ['C:\\Users\\hunter\\gteam\\packages\\mcp-server\\dist\\cli.js'],
    env: entry.env,
  });
  assert.equal(jsonStatus(broken, expected, missingScript), 'needs_repair');

  const drifted = upsertJsonMcp(null, {
    ...entry,
    env: { ...entry.env, GTEAM_DEFAULT_TEAM: 'mat' },
  });
  assert.equal(jsonStatus(drifted, expected, present), 'needs_repair');

  const ok = upsertJsonMcp('{"mcpServers":{"other":{"command":"npx"}}}', entry);
  assert.equal(jsonStatus(ok, expected, present), 'configured');
  assert.equal(jsonStatus('{', expected, present), 'needs_repair');
});

test('command path check flags absolute commands and script args', () => {
  const script: McpServerEntry = {
    command: 'node',
    args: ['C:\\Users\\hunter\\gteam\\packages\\mcp-server\\dist\\cli.js'],
    env: {},
  };
  assert.deepEqual(commandPaths(script), ['C:\\Users\\hunter\\gteam\\packages\\mcp-server\\dist\\cli.js']);
  assert.equal(entryStatus(script, expected, () => false), 'needs_repair');
  assert.deepEqual(commandPaths(entry), [launch.command]);
});

test('claude.json keeps account data and drops shadowed project servers', () => {
  const original = {
    userID: 'abc',
    mcpServers: { docs: { command: 'docs' } },
    projects: {
      '/work/app': {
        mcpServers: {
          gteam: { command: 'node', args: ['/missing/cli.js'], env: {} },
          keep: { command: 'keep' },
        },
      },
    },
  };
  assert.equal(claudeCodeStatus(JSON.stringify(original), expected, present), 'needs_repair');
  const updated = JSON.parse(upsertClaudeConfig(JSON.stringify(original), entry));
  assert.equal(updated.userID, 'abc');
  assert.equal(updated.mcpServers.docs.command, 'docs');
  assert.equal(updated.mcpServers.gteam.command, launch.command);
  assert.equal(updated.projects['/work/app'].mcpServers.gteam, undefined);
  assert.equal(updated.projects['/work/app'].mcpServers.keep.command, 'keep');
  assert.equal(claudeCodeStatus(JSON.stringify(updated), expected, present), 'configured');

  const removed = JSON.parse(removeClaudeConfig(JSON.stringify(updated)));
  assert.equal(removed.mcpServers.gteam, undefined);
  assert.equal(removed.userID, 'abc');
  assert.equal(claudeCodeStatus(JSON.stringify(removed), expected, present), 'unconfigured');
});

test('codex toml update is idempotent and preserves other tables', () => {
  const original = `
model = "gpt-5"

[mcp_servers.other]
command = "npx"
args = ["-y", "other"]

[mcp_servers.gteam]
command = "node"
args = ["/Users/hunter/gteam/packages/mcp-server/dist/cli.js"]

[mcp_servers.gteam.env]
GTEAM_TEAMS = '[]'
GTEAM_DEFAULT_TEAM = "old"

[projects."/tmp/app"]
trust_level = "trusted"
`.trim();

  const once = upsertCodexConfig(original, entry);
  const twice = upsertCodexConfig(once, entry);
  assert.equal(twice.split('[mcp_servers.gteam]').length - 1, 1);
  assert.match(twice, /\[mcp_servers\.other\]/);
  assert.match(twice, /trust_level = "trusted"/);
  assert.match(twice, /model = "gpt-5"/);
  const read = readCodexGteam(twice);
  assert.equal(read?.command, launch.command);
  assert.equal(codexStatus(twice, expected, present), 'configured');
  assert.equal(codexStatus(original, expected, () => false), 'needs_repair');

  const removed = removeCodexConfig(twice);
  assert.equal(removed.includes('mcp_servers.gteam'), false);
  assert.match(removed, /\[mcp_servers\.other\]/);
  assert.equal(codexStatus(removed, expected, present), 'unconfigured');
});

test('codebuddy writes the highest-priority existing file and reports shadow copies', () => {
  const files = [
    { path: '/Users/hunter/.codebuddy/.mcp.json', exists: false, text: null },
    {
      path: '/Users/hunter/.codebuddy/mcp.json',
      exists: true,
      text: JSON.stringify({ mcpServers: { gteam: { command: 'node', args: ['/missing.js'], env: entry.env } } }),
    },
    { path: '/Users/hunter/.codebuddy.json', exists: true, text: '{"numStartups":1}' },
  ];
  assert.equal(codeBuddyWritePath(files), files[1].path);
  assert.equal(codeBuddyStatus(files, expected, () => false), 'needs_repair');

  const fresh = [
    { path: '/home/hunter/.codebuddy/.mcp.json', exists: false, text: null },
    { path: '/home/hunter/.codebuddy/mcp.json', exists: false, text: null },
    { path: '/home/hunter/.codebuddy.json', exists: false, text: null },
  ];
  assert.equal(codeBuddyWritePath(fresh), fresh[0].path);
  assert.equal(codeBuddyStatus(fresh, expected, present), 'unconfigured');

  const shadowed = [
    {
      path: fresh[0].path,
      exists: true,
      text: upsertJsonMcp(null, entry),
    },
    {
      path: fresh[1].path,
      exists: true,
      text: upsertJsonMcp(null, entry),
    },
    fresh[2],
  ];
  assert.equal(codeBuddyStatus(shadowed, expected, present), 'needs_repair');
});

test('default team follows the active connection', () => {
  const picked = teamsForMcp(
    [
      connection({ id: 'a', serverUrl: 'http://one', teamName: 'one' }),
      connection({ id: 'b', serverUrl: 'http://two', teamName: 'two', isActive: true }),
    ],
    'b',
  );
  assert.equal(picked.defaultTeam, 'two');
  assert.equal(picked.teams[1].serverUrl, 'http://two');
});
