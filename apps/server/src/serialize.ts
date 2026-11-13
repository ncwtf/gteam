/** 把数据库蛇形字段转成客户端和 shared 类型使用的驼峰字段。 */

export function toIso(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseJson(value: unknown): unknown {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

export function mapUser(row: any) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: toIso(row.createdAt ?? row.created_at)
  };
}

export function mapTeam(row: any) {
  return {
    id: row.id,
    organizationId: row.organizationId ?? row.organization_id ?? null,
    name: row.name,
    description: row.description ?? null,
    createdAt: toIso(row.createdAt ?? row.created_at),
    updatedAt: toIso(row.updatedAt ?? row.updated_at),
    isAdmin: Boolean(row.isAdmin ?? row.is_admin),
    role: row.role ?? null
  };
}

export function mapInvite(row: any) {
  return {
    id: row.id,
    teamId: row.teamId ?? row.team_id,
    code: row.code,
    createdBy: row.createdBy ?? row.created_by,
    expiresAt: toIso(row.expiresAt ?? row.expires_at),
    maxUses: row.maxUses ?? row.max_uses ?? null,
    currentUses: row.currentUses ?? row.current_uses ?? 0,
    createdAt: toIso(row.createdAt ?? row.created_at)
  };
}

export function mapProject(row: any) {
  return {
    id: row.id,
    teamId: row.teamId ?? row.team_id,
    name: row.name,
    description: row.description ?? null,
    gitRepoUrl: row.gitRepoUrl ?? row.git_repo_url ?? null,
    linkedProjectIds: row.linkedProjectIds ?? row.linked_project_ids ?? [],
    createdAt: toIso(row.createdAt ?? row.created_at),
    updatedAt: toIso(row.updatedAt ?? row.updated_at)
  };
}

export function mapDocument(row: any) {
  return {
    id: row.id,
    projectId: row.projectId ?? row.project_id,
    title: row.title,
    content: row.content ?? '',
    partition: row.partition,
    ownerId: row.ownerId ?? row.owner_id,
    metadata: parseJson(row.metadata),
    createdAt: toIso(row.createdAt ?? row.created_at),
    updatedAt: toIso(row.updatedAt ?? row.updated_at)
  };
}

export function mapRequirement(row: any) {
  return {
    id: row.id,
    projectId: row.projectId ?? row.project_id,
    title: row.title,
    description: row.description ?? '',
    gitBranch: row.gitBranch ?? row.git_branch,
    gitRepoUrl: row.gitRepoUrl ?? row.git_repo_url ?? null,
    assigneeId: row.assigneeId ?? row.assignee_id ?? null,
    status: row.status,
    createdBy: row.createdBy ?? row.created_by,
    createdAt: toIso(row.createdAt ?? row.created_at),
    updatedAt: toIso(row.updatedAt ?? row.updated_at)
  };
}

export function mapIssue(row: any) {
  return {
    id: row.id,
    projectId: row.projectId ?? row.project_id,
    requirementId: row.requirementId ?? row.requirement_id ?? null,
    title: row.title,
    description: row.description ?? '',
    priority: row.priority,
    status: row.status,
    createdBy: row.createdBy ?? row.created_by,
    assignedTo: row.assignedTo ?? row.assigned_to ?? null,
    createdByAI: Boolean(row.createdByAI ?? row.created_by_ai),
    createdAt: toIso(row.createdAt ?? row.created_at),
    updatedAt: toIso(row.updatedAt ?? row.updated_at)
  };
}

export function mapReply(row: any) {
  return {
    id: row.id,
    issueId: row.issueId ?? row.issue_id,
    userId: row.userId ?? row.user_id,
    content: row.content ?? '',
    createdByAI: Boolean(row.createdByAI ?? row.created_by_ai),
    createdAt: toIso(row.createdAt ?? row.created_at)
  };
}
