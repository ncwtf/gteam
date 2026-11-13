export const requirementStatusLabel: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '阻塞'
};

export const requirementStatusColor: Record<string, string> = {
  pending: '#999',
  in_progress: '#0066cc',
  completed: '#00aa00',
  blocked: '#cc0000'
};

export const issuePriorityLabel: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急'
};

export const issueStatusLabel: Record<string, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭'
};

export const partitionLabel: Record<string, string> = {
  personal: '个人',
  shared: '只读',
  collaborative: '协作'
};
