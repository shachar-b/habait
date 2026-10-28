import type {
  AdminPoolListResponse,
  CompleteResponse,
  CreateOneOffRequest,
  CreatePeerRequest,
  CreatePoolTaskRequest,
  CreateRoutineRequest,
  CreateUserRequest,
  DashboardResponse,
  ErrorCode,
  HistoryResponse,
  LobbyResponse,
  LoginRequest,
  LoginResponse,
  OneOffTask,
  PeerRequestResponse,
  PoolCompleteResponse,
  PoolListResponse,
  PoolTaskResponse,
  RevertResponse,
  RoutineListResponse,
  RoutineResponse,
  SettingsResponse,
  StarsSummaryResponse,
  UpdateOneOffRequest,
  UpdateOwnProfileRequest,
  UpdatePoolTaskRequest,
  UpdateRoutineRequest,
  UpdateSettingsRequest,
  UpdateUserRequest,
  User,
  UserListResponse,
  UserResponse,
} from '@habait/shared';

export class ClientApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'ClientApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
  };
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'אירעה שגיאה בשרת';
    try {
      const errBody = (await res.json()) as {
        error?: { code?: ErrorCode; message?: string };
      };
      if (errBody.error?.code) code = errBody.error.code;
      if (errBody.error?.message) message = errBody.error.message;
    } catch {
      // ignore json parse failure
    }
    throw new ClientApiError(code, message, res.status);
  }

  return (await res.json()) as T;
}

export const api = {
  getLobby: () => request<LobbyResponse>('/api/v1/lobby'),

  login: (payload: LoginRequest) =>
    request<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () =>
    request<{ ok: boolean }>('/api/v1/auth/logout', {
      method: 'POST',
    }),

  getMe: () => request<{ user: User | null }>('/api/v1/auth/me'),

  updateOwnProfile: (payload: UpdateOwnProfileRequest) =>
    request<UserResponse>('/api/v1/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getDashboard: (userId: number) =>
    request<DashboardResponse>(`/api/v1/users/${userId}/dashboard`),

  completeRoutine: (routineId: number) =>
    request<CompleteResponse>(`/api/v1/routines/${routineId}/complete`, {
      method: 'POST',
    }),

  revertRoutine: (logId: number) =>
    request<RevertResponse>(`/api/v1/routines/${logId}/revert`, {
      method: 'POST',
    }),

  completeOneOff: (taskId: number) =>
    request<CompleteResponse>(`/api/v1/one-offs/${taskId}/complete`, {
      method: 'POST',
    }),

  revertOneOff: (taskId: number) =>
    request<RevertResponse>(`/api/v1/one-offs/${taskId}/revert`, {
      method: 'POST',
    }),

  getPool: () => request<PoolListResponse>('/api/v1/pool'),

  claimPoolTask: (taskId: number) =>
    request<PoolTaskResponse>(`/api/v1/pool/${taskId}/claim`, {
      method: 'POST',
    }),

  unclaimPoolTask: (taskId: number) =>
    request<PoolTaskResponse>(`/api/v1/pool/${taskId}/unclaim`, {
      method: 'POST',
    }),

  completePoolTask: (taskId: number) =>
    request<PoolCompleteResponse>(`/api/v1/pool/${taskId}/complete`, {
      method: 'POST',
    }),

  revertPoolExecution: (execId: number) =>
    request<RevertResponse>(`/api/v1/pool/executions/${execId}/revert`, {
      method: 'POST',
    }),

  createPeerRequest: (payload: CreatePeerRequest) =>
    request<PeerRequestResponse>('/api/v1/peer-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  completePeerRequest: (id: number) =>
    request<PeerRequestResponse>(`/api/v1/peer-requests/${id}/complete`, {
      method: 'POST',
    }),

  declinePeerRequest: (id: number) =>
    request<PeerRequestResponse>(`/api/v1/peer-requests/${id}/decline`, {
      method: 'POST',
    }),

  cancelPeerRequest: (id: number) =>
    request<PeerRequestResponse>(`/api/v1/peer-requests/${id}/cancel`, {
      method: 'POST',
    }),

  revertPeerRequest: (id: number) =>
    request<RevertResponse>(`/api/v1/peer-requests/${id}/revert`, {
      method: 'POST',
    }),

  getStarsSummary: () => request<StarsSummaryResponse>('/api/v1/stars/summary'),

  getHistory: (date: string) =>
    request<HistoryResponse>(`/api/v1/history?date=${encodeURIComponent(date)}`),

  // Admin endpoints (/api/v1/admin/*)
  updateSettings: (payload: UpdateSettingsRequest) =>
    request<SettingsResponse>('/api/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminGetUsers: () => request<UserListResponse>('/api/v1/admin/users'),

  adminCreateUser: (payload: CreateUserRequest) =>
    request<UserResponse>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdateUser: (id: number, payload: UpdateUserRequest) =>
    request<UserResponse>(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminDeleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/v1/admin/users/${id}`, {
      method: 'DELETE',
    }),

  adminGetRoutines: () => request<RoutineListResponse>('/api/v1/admin/routines'),

  adminCreateRoutine: (payload: CreateRoutineRequest) =>
    request<RoutineResponse>('/api/v1/admin/routines', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdateRoutine: (id: number, payload: UpdateRoutineRequest) =>
    request<RoutineResponse>(`/api/v1/admin/routines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminGetOneOffs: () => request<{ tasks: OneOffTask[] }>('/api/v1/admin/one-offs'),

  adminCreateOneOff: (payload: CreateOneOffRequest) =>
    request<{ task: OneOffTask }>('/api/v1/admin/one-offs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdateOneOff: (id: number, payload: UpdateOneOffRequest) =>
    request<{ task: OneOffTask }>(`/api/v1/admin/one-offs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminCancelOneOff: (id: number) =>
    request<{ task: OneOffTask }>(`/api/v1/admin/one-offs/${id}/cancel`, {
      method: 'POST',
    }),

  adminGetPool: () => request<AdminPoolListResponse>('/api/v1/admin/pool'),

  adminCreatePoolTask: (payload: CreatePoolTaskRequest) =>
    request<PoolTaskResponse>('/api/v1/admin/pool', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdatePoolTask: (id: number, payload: UpdatePoolTaskRequest) =>
    request<PoolTaskResponse>(`/api/v1/admin/pool/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminTogglePoolActive: (id: number) =>
    request<PoolTaskResponse>(`/api/v1/admin/pool/${id}/toggle-active`, {
      method: 'PATCH',
    }),
};
