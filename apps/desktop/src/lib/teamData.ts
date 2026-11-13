import { TeamConnection } from '@gteam/shared';
import { getApiErrorMessage } from './apiError';
import { createApiClient, useStore } from '../store';

export async function reloadProjects(connection: TeamConnection): Promise<void> {
  if (!connection.token) return;
  try {
    const api = createApiClient(connection);
    const response = await api.get('/api/projects');
    if (response.data?.success === false) {
      useStore.getState().setProjectsError(connection.id, response.data.error || '加载项目失败');
      return;
    }
    useStore.getState().setProjects(connection.id, response.data?.data || []);
  } catch (error) {
    useStore.getState().setProjectsError(connection.id, getApiErrorMessage(error, '加载项目失败'));
  }
}
