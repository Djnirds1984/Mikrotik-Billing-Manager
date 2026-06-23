import { dbApi } from './databaseService.ts';
import type { WanSettings, NetworkStatus, AvailableInterfacesResponse } from '../types.ts';

export const getWanSettings = (): Promise<WanSettings> => {
  return dbApi.get<WanSettings>('/wan-settings');
};

export const saveWanSettings = (settings: Partial<WanSettings>): Promise<{ message: string }> => {
  return dbApi.post<{ message: string }>('/wan-settings', settings);
};

export const applyWanSettings = (): Promise<{ message: string; success: boolean }> => {
  return dbApi.post<{ message: string; success: boolean }>('/wan-settings/apply', {});
};

export const getNetworkStatus = (): Promise<NetworkStatus> => {
  return dbApi.get<NetworkStatus>('/wan-settings/status');
};

export const getAvailableInterfaces = (): Promise<AvailableInterfacesResponse> => {
  return dbApi.get<AvailableInterfacesResponse>('/wan-settings/interfaces');
};
