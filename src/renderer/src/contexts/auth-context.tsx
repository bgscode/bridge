import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, assignmentsApi, clearToken, getToken, setToken, type AuthUser } from '@/lib/api'
import { canEditJobVariables as checkCanEditJobVariables } from '@/lib/job-permissions'

interface RegisterInput {
  userId: string
  name: string
  phone: string
  email?: string
  password: string
}

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  variableEditJobIds: ReadonlySet<string>
  canEditJobVariables: (jobRemoteId: string | null | undefined) => boolean
  login: (identifier: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function loadVariableEditJobIds(user: AuthUser): Promise<string[]> {
  if (user.role === 'admin') return []
  try {
    const assignments = await assignmentsApi.get(user.id)
    return assignments.jobs.filter((job) => job.canEditVariables).map((job) => job.jobId)
  } catch {
    return []
  }
}

async function syncMainAuthContext(
  token: string | null,
  role: string | null,
  variableEditJobIds: string[]
): Promise<void> {
  await window.api.auth.setContext(token, role, variableEditJobIds)
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [variableEditJobIds, setVariableEditJobIds] = useState<ReadonlySet<string>>(new Set())

  const refresh = async (): Promise<void> => {
    const token = getToken()
    if (!token) {
      setUser(null)
      setVariableEditJobIds(new Set())
      await syncMainAuthContext(null, null, [])
      setIsLoading(false)
      return
    }
    try {
      const me = await authApi.me()
      const editJobIds = await loadVariableEditJobIds(me)
      setUser(me)
      setVariableEditJobIds(new Set(editJobIds))
      await syncMainAuthContext(token, me.role, editJobIds)
    } catch {
      clearToken()
      setUser(null)
      setVariableEditJobIds(new Set())
      await syncMainAuthContext(null, null, [])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const onUnauthorized = (): void => setUser(null)
    window.addEventListener('bridge:unauthorized', onUnauthorized)
    return () => window.removeEventListener('bridge:unauthorized', onUnauthorized)
  }, [])

  const login = async (identifier: string, password: string): Promise<void> => {
    const { token, user: u } = await authApi.login(identifier, password)
    setToken(token)
    const editJobIds = await loadVariableEditJobIds(u)
    setUser(u)
    setVariableEditJobIds(new Set(editJobIds))
    await syncMainAuthContext(token, u.role, editJobIds)
    // Pull-only sync from server on login. Server = master.
    try {
      await window.api.sync.run(token)
    } catch (err) {
      console.warn('[auth] post-login sync failed:', err)
    }
    // Kick off a non-blocking connectivity test for all visible connections
    // so the UI shows live online/offline status right after login.
    void (async (): Promise<void> => {
      try {
        const all = await window.api.connections.getAll()
        const ids = all.map((c) => c.id)
        if (ids.length > 0) await window.api.connections.testAll(ids)
      } catch (err) {
        console.warn('[auth] post-login connection test failed:', err)
      }
    })()
  }

  const register = async (input: RegisterInput): Promise<void> => {
    await authApi.register(input)
    // Registration doesn't auto-login — caller redirects to login
  }

  const logout = async (): Promise<void> => {
    try {
      await authApi.logout()
    } catch {
      // ignore — clear local state anyway
    }
    clearToken()
    setUser(null)
    setVariableEditJobIds(new Set())
    await syncMainAuthContext(null, null, [])
  }

  const canEditJobVariables = useMemo(
    () => (jobRemoteId: string | null | undefined) =>
      checkCanEditJobVariables(jobRemoteId, user?.role === 'admin', variableEditJobIds),
    [user?.role, variableEditJobIds]
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        variableEditJobIds,
        canEditJobVariables,
        login,
        register,
        logout,
        refresh
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
