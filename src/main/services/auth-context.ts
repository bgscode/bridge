/**
 * Stores the current renderer auth token + user role in the main process so
 * IPC handlers can authenticate back to the remote server when mirroring
 * admin writes.
 */
let storedToken: string | null = null
let storedRole: string | null = null

export function setAuthContext(token: string | null, role: string | null): void {
  storedToken = token
  storedRole = role
}

export function getAuthToken(): string | null {
  return storedToken
}

export function isAdmin(): boolean {
  return storedRole === 'admin'
}
