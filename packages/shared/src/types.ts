/**
 * gteam (God Team) 核心类型定义
 * 
 * 架构说明:
 * - 每个团队自托管独立的服务器
 * - 桌面客户端可连接多个团队（Discord 风格）
 * - 数据在客户端按团队隔离存储
 */

// ============ 多团队连接 ============

export interface TeamConnection {
  id: string; // 本地生成的连接 ID
  serverUrl: string; // 团队服务器 URL
  teamName: string;
  teamId?: string; // 服务器上的团队 ID，创建项目时需要
  token: string; // 该服务器的 JWT token
  userId: string;
  userName: string;
  isAdmin?: boolean;
  isActive: boolean; // 当前激活的团队
  joinedAt: Date;
  lastSyncAt?: Date;
}

export interface InviteLink {
  serverUrl: string;
  inviteCode: string;
  teamName?: string;
  expiresAt?: Date;
}

// ============ 用户和组织 ============

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Organization {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum MemberRole {
  UI = 'UI',
  Product = '产品',
  Backend = '后端',
  Frontend = '前端',
  FullStack = '全栈',
  Other = '其他'
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: MemberRole;
  isAdmin: boolean;
  joinedAt: Date;
}

// ============ 项目 ============

export interface Project {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  gitRepoUrl?: string;
  linkedProjectIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ============ 文档 ============

export enum DocumentPartition {
  Personal = 'personal',
  Shared = 'shared',
  Collaborative = 'collaborative'
}

export interface DocumentMetadata {
  projectId: string;
  ownerId: string;
  role?: MemberRole;
  tags?: string[];
  relatedRequirementId?: string;
  relatedBranch?: string;
}

export interface Document {
  id: string;
  projectId: string;
  title: string;
  content: string; // Markdown with front-matter
  partition: DocumentPartition;
  ownerId: string;
  metadata: DocumentMetadata;
  createdAt: Date;
  updatedAt: Date;
}

// ============ 需求 ============

export interface Requirement {
  id: string;
  projectId: string;
  title: string;
  description: string;
  gitBranch: string;
  gitRepoUrl?: string;
  assigneeId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============ Git 进度 ============

export interface GitProgress {
  id: string;
  requirementId: string;
  userId: string;
  branch: string;
  repoPath: string;
  commitHash: string;
  commitMessage: string;
  timestamp: Date;
}

// ============ 问题和协作 ============

export interface Issue {
  id: string;
  projectId: string;
  requirementId?: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdBy: string;
  assignedTo?: string;
  createdByAI: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueReply {
  id: string;
  issueId: string;
  userId: string;
  content: string;
  createdByAI: boolean;
  createdAt: Date;
}

// ============ WebSocket 事件 ============

export enum WSEventType {
  // 文档事件
  DocumentCreated = 'document:created',
  DocumentUpdated = 'document:updated',
  DocumentDeleted = 'document:deleted',
  
  // 需求事件
  RequirementCreated = 'requirement:created',
  RequirementUpdated = 'requirement:updated',
  RequirementStatusChanged = 'requirement:status_changed',
  
  // Git 进度事件
  GitProgressUpdated = 'git:progress_updated',
  
  // 问题事件
  IssueCreated = 'issue:created',
  IssueUpdated = 'issue:updated',
  IssueReplied = 'issue:replied',
  
  // 系统事件
  UserJoined = 'user:joined',
  UserLeft = 'user:left'
}

export interface WSEvent<T = any> {
  type: WSEventType;
  teamId: string;
  projectId?: string;
  payload: T;
  timestamp: Date;
  userId?: string;
  // 新增: 用于客户端聚合通知时标识来源
  serverUrl?: string;
  teamName?: string;
}

// ============ API 请求/响应 ============

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============ 权限 ============

export interface PermissionCheck {
  userId: string;
  resourceType: 'document' | 'project' | 'requirement' | 'issue';
  resourceId: string;
  action: 'read' | 'write' | 'delete' | 'admin';
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

// ============ 邀请系统 ============

export interface Invite {
  id: string;
  teamId: string;
  code: string;
  createdBy: string;
  expiresAt?: Date;
  maxUses?: number;
  currentUses: number;
  createdAt: Date;
}
