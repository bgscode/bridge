/**
 * Stores the current renderer auth token + user role in the main process so
 * IPC handlers can authenticate back to the remote server when mirroring
 * admin writes.
 */
let storedToken: string | null = null
let storedRole: string | null = null
let variableEditJobRemoteIds = new Set<string>()

export function setAuthContext(
  token: string | null,
  role: string | null,
  variableEditJobIds: string[] = []
): void {
  storedToken = token
  storedRole = role
  variableEditJobRemoteIds = new Set(variableEditJobIds)
}

export function getAuthToken(): string | null {
  return storedToken
}

export function isAdmin(): boolean {
  return storedRole === 'admin'
}

export function canEditJobVariables(remoteJobId: string | null | undefined): boolean {
  if (isAdmin()) return true
  if (!remoteJobId) return false
  return variableEditJobRemoteIds.has(remoteJobId)
}
