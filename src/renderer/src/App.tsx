import { Suspense, lazy } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/layout'
import { getRoutesForRole } from '@/routes'
import { ThemeProvider } from './components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { FloatingJobProgress } from '@/components/floating-job-progress'
import { AuthProvider, useAuth } from '@/contexts/auth-context'
import { Loader2Icon } from 'lucide-react'
import {
  GroupsProvider,
  JobGroupsProvider,
  StoresProvider,
  FiscalYearsProvider,
  ConnectionsProvider,
  JobsProvider
} from '@/contexts'
import { useSyncRefresh } from '@/hooks/use-sync-refresh'

const LoginPage = lazy(() => import('@/pages/login'))

function SyncRefreshBridge(): null {
  useSyncRefresh()
  return null
}

function AuthGate(): React.JSX.Element {
  const { isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return (
      <Suspense
        fallback={
          <div className="flex h-screen w-screen items-center justify-center bg-background">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <LoginPage />
      </Suspense>
    )
  }

  const allowed = getRoutesForRole(user.role)
  const landing = '/'

  return (
    <GroupsProvider>
      <JobGroupsProvider>
        <StoresProvider>
          <FiscalYearsProvider>
            <ConnectionsProvider>
              <JobsProvider>
                <SyncRefreshBridge />
                <Layout>
                  <Suspense
                    fallback={<div className="text-muted-foreground text-sm">Loading...</div>}
                  >
                    <Routes>
                      {allowed.map((route) => (
                        <Route key={route.path} path={route.path} element={route.element} />
                      ))}
                      <Route path="*" element={<Navigate to={landing} replace />} />
                    </Routes>
                  </Suspense>
                </Layout>
                <FloatingJobProgress />
              </JobsProvider>
            </ConnectionsProvider>
          </FiscalYearsProvider>
        </StoresProvider>
      </JobGroupsProvider>
    </GroupsProvider>
  )
}

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <ThemeProvider>
        <AuthProvider>
          <AuthGate />
          <Toaster richColors />
        </AuthProvider>
      </ThemeProvider>
    </HashRouter>
  )
}

export default App
