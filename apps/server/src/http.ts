import { Response } from 'express';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT = /^[a-z_]+$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function field(body: any, ...keys: string[]): unknown {
  if (!body || typeof body !== 'object') return undefined;
  for (const key of keys) {
    if (body[key] !== undefined) return body[key];
  }
  return undefined;
}

export function sendPermission(
  res: Response,
  permission: { allowed: boolean; reason?: string }
) {
  const reason = permission.reason || '无权访问';
  const notFound = reason.includes('不存在') && !reason.includes('不是');
  res.status(notFound ? 404 : 403).json({ success: false, error: reason });
}

/** 只更新调用方明确传入的列。undefined 表示不改，null 表示清空。 */
export function buildPatch(
  table: string,
  id: string,
  columns: Record<string, unknown>
): { text: string; params: unknown[] } | null {
  if (!IDENT.test(table)) {
    throw new Error(`非法表名: ${table}`);
  }
  const entries = Object.entries(columns).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return null;
  for (const [column] of entries) {
    if (!IDENT.test(column)) {
      throw new Error(`非法列名: ${column}`);
    }
  }
  const params = entries.map(([, value]) => value);
  params.push(id);
  const sets = entries.map(([column], index) => `${column} = $${index + 1}`);
  return {
    text: `UPDATE ${table} SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING *`,
    params
  };
}
