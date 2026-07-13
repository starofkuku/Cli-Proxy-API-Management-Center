/**
 * 版本相关 API
 */

import { apiClient } from './client';
import type { ServerRuntimeKind } from '@/types';
import { isRecord } from '@/utils/helpers';

export interface ManagementPanelSyncResponse {
  status: 'updated' | 'up-to-date';
  updated: boolean;
  available: boolean;
  sha256?: string;
}

export const versionApi = {
  checkLatest: () => apiClient.get<Record<string, unknown>>('/latest-version'),

  syncManagementPanel: () => apiClient.post<ManagementPanelSyncResponse>('/management-panel/sync'),

  async detectRuntimeKind(): Promise<ServerRuntimeKind> {
    try {
      const data = await apiClient.get('/nodes');
      return isRecord(data) && Array.isArray(data.nodes) ? 'home' : 'unknown';
    } catch (error: unknown) {
      const status = isRecord(error) ? error.status : undefined;
      if (status === 404 || status === 405) {
        return 'cpa';
      }
      return 'unknown';
    }
  },
};
