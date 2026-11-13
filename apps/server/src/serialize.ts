/**
 * 把数据库的 snake_case 行转成与 @gteam/shared 一致的 camelCase。
 * 客户端和 MCP 都按这套字段读取。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function requiredText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalText(value: unknown): string | null {
  const text = requiredText(value);
  return text ? text : null;
}

export function toIso(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function toBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pick(row: Record<string, any>, camel: string, snake: string) {
  if (row[camel] !== undefined) return row[camel];
  return row[snake];
}

export function serializeUser(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: toIso(pick(row, 'createdAt', 'created_at')),
    updatedAt: toIso(pick(row, 'updatedAt', 'updated_at'))
  };
}

export function serializeTeam(row: any) {
  if (!row) return row;
  const isAdmin = pick(row, 'isAdmin', 'is_admin');
  return {
    id: row.id,
    organizationId: pick(row, 'organizationId', 'organization_id') ?? null,
    name: row.name,
    description: row.description ?? null,
    createdAt: toIso(pick(row, 'createdAt', 'created_at')),
    updatedAt: toIso(pick(row, 'updatedAt', 'updated_at')),
    ...(isAdmin === undefined ? {} : { isAdmin: toBool(isAdmin) })
  };
}

export function serializeInvite(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    teamId: pick(row, 'teamId', 'team_id'),
    code: row.code,
    createdBy: pick(row, 'createdBy', 'created_by'),
    expiresAt: toIso(pick(row, 'expiresAt', 'expires_at')),
    maxUses: pick(row, 'maxUses', 'max_uses') ?? null,
    currentUses: pick(row, 'currentUses', 'current_uses') ?? 0,
    createdAt: toIso(pick(row, 'createdAt', 'created_at')),
    ...(row.teamName ? { teamName: row.teamName } : {}),
    ...(row.inviteUrl ? { inviteUrl: row.inviteUrl } : {})
  };
}

export function serializeProject(row: any) {
  if (!row) return row;
  const linked = pick(row, 'linkedProjectIds', 'linked_project_ids');
  return {
    id: row.id,
    teamId: pick(row, 'teamId', 'team_id'),
    name: row.name,
    description: row.description ?? null,
    gitRepoUrl: pick(row, 'gitRepoUrl', 'git_repo_url') ?? null,
    linkedProjectIds: Array.isArray(linked) ? linked : [],
    createdAt: toIso(pick(row, 'createdAt', 'created_at')),
    updatedAt: toIso(pick(row, 'updatedAt', 'updated_at'))
  };
}

export function serializeDocument(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    projectId: pick(row, 'projectId', 'project_id'),
    title: row.title,
    content: row.content ?? '',
    partition: row.partition,
    ownerId: pick(row, 'ownerId', 'owner_id'),
    metadata: parseMetadata(row.metadata),
    createdAt: toIso(pick(row, 'createdAt', 'created_at')),
    updatedAt: toIso(pick(row, 'updatedAt', 'updated_at'))
  };
}

export function serializeRequirement(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    projectId: pick(row, 'projectId', 'project_id'),
    title: row.title,
    description: row.description ?? '',
    gitBranch: pick(row, 'gitBranch', 'git_branch'),
    gitRepoUrl: pick(row, 'gitRepoUrl', 'git_repo_url') ?? null,
    assigneeId: pick(row, 'assigneeId', 'assignee_id') ?? null,
    status: row.status,
    createdBy: pick(row, 'createdBy', 'created_by'),
    createdAt: toIso(pick(row, 'createdAt', 'created_at')),
    updatedAt: toIso(pick(row, 'updatedAt', 'updated_at'))
  };
}

export function serializeIssue(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    projectId: pick(row, 'projectId', 'project_id'),
    requirementId: pick(row, 'requirementId', 'requirement_id') ?? null,
    title: row.title,
    description: row.description ?? '',
    priority: row.priority,
    status: row.status,
    createdBy: pick(row, 'createdBy', 'created_by'),
    assignedTo: pick(row, 'assignedTo', 'assigned_to') ?? null,
    createdByAI: toBool(pick(row, 'createdByAI', 'created_by_ai')),
    createdAt: toIso(pick(row, 'createdAt', 'created_at')),
    updatedAt: toIso(pick(row, 'updatedAt', 'updated_at'))
  };
}

export function serializeIssueReply(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    issueId: pick(row, 'issueId', 'issue_id'),
    userId: pick(row, 'userId', 'user_id'),
    content: row.content ?? '',
    createdByAI: toBool(pick(row, 'createdByAI', 'created_by_ai')),
    createdAt: toIso(pick(row, 'createdAt', 'created_at'))
  };
}
