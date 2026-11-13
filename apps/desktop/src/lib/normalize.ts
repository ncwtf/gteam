import { Document, Issue, IssueReply, Project, Requirement } from '@gteam/shared';

function parseMetadata(value: unknown): Document['metadata'] {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return { projectId: '', ownerId: '' };
    }
  }
  if (value && typeof value === 'object') return value as Document['metadata'];
  return { projectId: '', ownerId: '' };
}

export function formatDate(value: unknown): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN');
}

export function previewText(value: unknown, max = 200): string {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export function normalizeProject(raw: any): Project {
  return {
    id: String(raw?.id ?? ''),
    teamId: raw?.teamId ?? raw?.team_id,
    name: raw?.name ?? '',
    description: raw?.description ?? undefined,
    gitRepoUrl: raw?.gitRepoUrl ?? raw?.git_repo_url ?? undefined,
    linkedProjectIds: raw?.linkedProjectIds ?? raw?.linked_project_ids ?? undefined,
    createdAt: raw?.createdAt ?? raw?.created_at,
    updatedAt: raw?.updatedAt ?? raw?.updated_at
  };
}

export function normalizeDocument(raw: any): Document {
  return {
    id: String(raw?.id ?? ''),
    projectId: raw?.projectId ?? raw?.project_id,
    title: raw?.title ?? '',
    content: raw?.content ?? '',
    partition: raw?.partition,
    ownerId: raw?.ownerId ?? raw?.owner_id,
    metadata: parseMetadata(raw?.metadata),
    createdAt: raw?.createdAt ?? raw?.created_at,
    updatedAt: raw?.updatedAt ?? raw?.updated_at
  };
}

export function normalizeRequirement(raw: any): Requirement {
  return {
    id: String(raw?.id ?? ''),
    projectId: raw?.projectId ?? raw?.project_id,
    title: raw?.title ?? '',
    description: raw?.description ?? '',
    gitBranch: raw?.gitBranch ?? raw?.git_branch ?? '',
    gitRepoUrl: raw?.gitRepoUrl ?? raw?.git_repo_url ?? undefined,
    assigneeId: raw?.assigneeId ?? raw?.assignee_id ?? undefined,
    status: raw?.status ?? 'pending',
    createdBy: raw?.createdBy ?? raw?.created_by,
    createdAt: raw?.createdAt ?? raw?.created_at,
    updatedAt: raw?.updatedAt ?? raw?.updated_at
  };
}

export function normalizeIssue(raw: any): Issue {
  return {
    id: String(raw?.id ?? ''),
    projectId: raw?.projectId ?? raw?.project_id,
    requirementId: raw?.requirementId ?? raw?.requirement_id ?? undefined,
    title: raw?.title ?? '',
    description: raw?.description ?? '',
    priority: raw?.priority ?? 'medium',
    status: raw?.status ?? 'open',
    createdBy: raw?.createdBy ?? raw?.created_by,
    assignedTo: raw?.assignedTo ?? raw?.assigned_to ?? undefined,
    createdByAI: Boolean(raw?.createdByAI ?? raw?.created_by_ai),
    createdAt: raw?.createdAt ?? raw?.created_at,
    updatedAt: raw?.updatedAt ?? raw?.updated_at
  };
}

export function normalizeReply(raw: any): IssueReply {
  return {
    id: String(raw?.id ?? ''),
    issueId: raw?.issueId ?? raw?.issue_id,
    userId: raw?.userId ?? raw?.user_id,
    content: raw?.content ?? '',
    createdByAI: Boolean(raw?.createdByAI ?? raw?.created_by_ai),
    createdAt: raw?.createdAt ?? raw?.created_at
  };
}
