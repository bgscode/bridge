const API_BASE_URL = 'https://link.yonolight.com'
const TOKEN_KEY = 'bridge_auth_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type ApiOk<T> = { success: true; data: T }
type ApiFail = { success: false; message?: string; error?: string }
type ApiResponse<T> = ApiOk<T> | ApiFail

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { auth?: boolean } = { auth: true }
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.auth !== false) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })

  let json: ApiResponse<T>
  try {
    json = (await res.json()) as ApiResponse<T>
  } catch {
    throw new ApiError(`HTTP ${res.status}`, res.status)
  }

  if (!res.ok || !('success' in json) || !json.success) {
    const msg = (json as ApiFail).message ?? (json as ApiFail).error ?? `HTTP ${res.status}`
    if (res.status === 401) {
      clearToken()
      // Trigger app-wide auth state refresh
      window.dispatchEvent(new Event('bridge:unauthorized'))
    }
    throw new ApiError(msg, res.status)
  }

  return json.data
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  postPublic: <T>(path: string, body?: unknown) => request<T>('POST', path, body, { auth: false })
}

// ── Domain types ────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  userId: string
  name: string
  phone: string
  email: string | null
  role: 'admin' | 'user'
  createdAt: string
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

export interface ServerConnection {
  id: string
  userId: string
  name: string
  host: string
  port: number
  database: string
  username: string
  storeId: string | null
  createdAt: string
}

export interface ServerJob {
  id: string
  userId: string
  name: string
  destinationType: string
  destinationConfig: string
  operation: string
  sqlQuery: string[]
  connectionIds: string[]
  scheduleCron: string | null
  createdAt: string
  updatedAt: string
  user?: { id: string; name: string; email: string }
}

export interface JobRunSyncPayload {
  localId: string
  jobId: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  totalConnections: number
  completedConnections: number
  failedConnections: number
  totalRows: number
  error?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (identifier: string, password: string) =>
    api.postPublic<LoginResponse>('/api/users/login', { identifier, password }),
  register: (input: {
    userId: string
    name: string
    phone: string
    email?: string
    password: string
  }) => api.postPublic<AuthUser>('/api/users/register', input),
  me: () => api.get<AuthUser>('/api/users/me'),
  logout: () => api.post<{ message: string }>('/api/users/logout')
}

// ── Users (admin) ───────────────────────────────────────────────────────────

export interface AdminUserInput {
  userId: string
  name: string
  phone: string
  email?: string
  password: string
  role?: 'admin' | 'user'
}

export interface AdminUserUpdate {
  userId?: string
  name?: string
  phone?: string
  email?: string
  password?: string
  role?: 'admin' | 'user'
}

export const usersApi = {
  list: () => api.get<AuthUser[]>('/api/users'),
  create: (input: AdminUserInput) => api.post<AuthUser>('/api/users', input),
  update: (id: string, input: AdminUserUpdate) => api.patch<AuthUser>(`/api/users/${id}`, input),
  remove: (id: string) => api.delete<void>(`/api/users/${id}`)
}

// ── Assignments (admin) ─────────────────────────────────────────────────────

export interface UserAssignments {
  connectionIds: string[]
  jobIds: string[]
}

export const assignmentsApi = {
  get: (userId: string) => api.get<UserAssignments>(`/api/assignments/users/${userId}`),
  setConnections: (userId: string, ids: string[]) =>
    api.put<{ connectionIds: string[] }>(`/api/assignments/users/${userId}/connections`, { ids }),
  setJobs: (userId: string, ids: string[]) =>
    api.put<{ jobIds: string[] }>(`/api/assignments/users/${userId}/jobs`, { ids })
}

// ── Connections ─────────────────────────────────────────────────────────────

export const connectionsApi = {
  list: () => api.get<ServerConnection[]>('/api/connections'),
  assign: (connectionId: string, userId: string) =>
    api.post<ServerConnection>('/api/connections/assign', { connectionId, userId })
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export const jobsApi = {
  list: () => api.get<ServerJob[]>('/api/jobs'),
  assign: (jobId: string, userId: string) =>
    api.post<ServerJob>('/api/jobs/assign', { jobId, userId })
}

// ── Job Runs ────────────────────────────────────────────────────────────────

export const jobRunsApi = {
  sync: (payload: JobRunSyncPayload) => api.post<unknown>('/api/job-runs/sync', payload),
  adminUsage: () =>
    api.get<
      Array<{
        user: { id: string; name: string; email: string }
        totalRuns: number
        lastRunAt: string | null
      }>
    >('/api/job-runs/admin/usage'),
  adminAll: (filters?: { jobId?: string; userId?: string }) => {
    const qs = new URLSearchParams()
    if (filters?.jobId) qs.set('jobId', filters.jobId)
    if (filters?.userId) qs.set('userId', filters.userId)
    const q = qs.toString()
    return api.get<unknown[]>(`/api/job-runs/admin/all${q ? `?${q}` : ''}`)
  }
}
