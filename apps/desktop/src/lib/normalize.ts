import { Document, Issue, Project, Requirement } from '@gteam/shared';

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function field(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 't' || value === 1;
}

export function formatDateTime(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN');
}

export function normalizeProject(input: unknown): Project {
  const row = asRecord(input);
  const linked = field(row, 'linkedProjectIds', 'linked_project_ids');
  return {
    id: stringOrEmpty(field(row, 'id')),
    teamId: stringOrEmpty(field(row, 'teamId', 'team_id')),
    name: stringOrEmpty(field(row, 'name')),
    description: optionalString(field(row, 'description')),
    gitRepoUrl: optionalString(field(row, 'gitRepoUrl', 'git_repo_url')),
    linkedProjectIds: Array.isArray(linked) ? linked.map(String) : undefined,
    createdAt: field(row, 'createdAt', 'created_at') as Project['createdAt'],
    updatedAt: field(row, 'updatedAt', 'updated_at') as Project['updatedAt']
  };
}

export function normalizeDocument(input: unknown): Document {
  const row = asRecord(input);
  const metadata = field(row, 'metadata');
  return {
    id: stringOrEmpty(field(row, 'id')),
    projectId: stringOrEmpty(field(row, 'projectId', 'project_id')),
    title: stringOrEmpty(field(row, 'title')),
    content: stringOrEmpty(field(row, 'content')),
    partition: (optionalString(field(row, 'partition')) || 'collaborative') as Document['partition'],
    ownerId: stringOrEmpty(field(row, 'ownerId', 'owner_id')),
    metadata: (metadata && typeof metadata === 'object' ? metadata : {}) as Document['metadata'],
    createdAt: field(row, 'createdAt', 'created_at') as Document['createdAt'],
    updatedAt: field(row, 'updatedAt', 'updated_at') as Document['updatedAt']
  };
}

export function normalizeRequirement(input: unknown): Requirement {
  const row = asRecord(input);
  return {
    id: stringOrEmpty(field(row, 'id')),
    projectId: stringOrEmpty(field(row, 'projectId', 'project_id')),
    title: stringOrEmpty(field(row, 'title')),
    description: stringOrEmpty(field(row, 'description')),
    gitBranch: stringOrEmpty(field(row, 'gitBranch', 'git_branch')),
    gitRepoUrl: optionalString(field(row, 'gitRepoUrl', 'git_repo_url')),
    assigneeId: optionalString(field(row, 'assigneeId', 'assignee_id')),
    status: (optionalString(field(row, 'status')) || 'pending') as Requirement['status'],
    createdBy: stringOrEmpty(field(row, 'createdBy', 'created_by')),
    createdAt: field(row, 'createdAt', 'created_at') as Requirement['createdAt'],
    updatedAt: field(row, 'updatedAt', 'updated_at') as Requirement['updatedAt']
  };
}

export function normalizeIssue(input: unknown): Issue {
  const row = asRecord(input);
  return {
    id: stringOrEmpty(field(row, 'id')),
    projectId: stringOrEmpty(field(row, 'projectId', 'project_id')),
    requirementId: optionalString(field(row, 'requirementId', 'requirement_id')),
    title: stringOrEmpty(field(row, 'title')),
    description: stringOrEmpty(field(row, 'description')),
    priority: (optionalString(field(row, 'priority')) || 'medium') as Issue['priority'],
    status: (optionalString(field(row, 'status')) || 'open') as Issue['status'],
    createdBy: stringOrEmpty(field(row, 'createdBy', 'created_by')),
    assignedTo: optionalString(field(row, 'assignedTo', 'assigned_to')),
    createdByAI: optionalBool(field(row, 'createdByAI', 'created_by_ai')),
    createdAt: field(row, 'createdAt', 'created_at') as Issue['createdAt'],
    updatedAt: field(row, 'updatedAt', 'updated_at') as Issue['updatedAt']
  };
}

export interface NormalizedTeam {
  id: string;
  name?: string;
  isAdmin?: boolean;
}

export function normalizeTeam(input: unknown): NormalizedTeam {
  const row = asRecord(input);
  const isAdmin = field(row, 'isAdmin', 'is_admin');
  return {
    id: stringOrEmpty(field(row, 'id')),
    name: optionalString(field(row, 'name')),
    ...(typeof isAdmin === 'boolean' ? { isAdmin } : {})
  };
}
