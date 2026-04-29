/* @refresh reset */
import { lazy, ReactNode } from 'react'
import {
  LayoutDashboardIcon,
  ListIcon,
  ChartBarIcon,
  UsersIcon,
  PlusIcon,
  Link,
  Layers,
  Store,
  CalendarRange,
  CalendarClock,
  Settings,
  BriefcaseBusiness
} from 'lucide-react'

// Lazy load pages — add new pages here, they auto-register in sidebar + router
const DashboardPage = lazy(() => import('@/pages/dashboard'))
const ConnectionPage = lazy(() => import('@/pages/connection'))
const LifecyclePage = lazy(() => import('@/pages/lifecycle'))
const AnalyticsPage = lazy(() => import('@/pages/analytics'))
const TeamPage = lazy(() => import('@/pages/team'))
const CreatePage = lazy(() => import('@/pages/create'))
const GroupsPage = lazy(() => import('@/pages/groups'))
const StoresPage = lazy(() => import('@/pages/stores'))
const FiscalYearsPage = lazy(() => import('@/pages/fiscal-years'))
const SettingsPage = lazy(() => import('@/pages/settings'))
const JobsPage = lazy(() => import('@/pages/jobs'))
const JobGroupPage = lazy(() => import('@/pages/job-group'))
const SchedulePage = lazy(() => import('@/pages/schedule'))

export type UserRole = 'admin' | 'user'

export interface RouteConfig {
  path: string
  label: string
  icon: ReactNode
  element: ReactNode
  showInSidebar?: boolean
  group?: 'main' | 'settings'
  /** Roles allowed to see & access this route. Omit = all authenticated users. */
  roles?: UserRole[]
}

// Routes visible to regular users: jobs, schedule, analytics only.
const USER_VISIBLE: UserRole[] = ['admin', 'user']
const ADMIN_ONLY: UserRole[] = ['admin']

export const routes: RouteConfig[] = [
  {
    path: '/',
    label: 'Dashboard',
    icon: <LayoutDashboardIcon className="size-4" />,
    element: <DashboardPage />,
    showInSidebar: true,
    group: 'main',
    roles: USER_VISIBLE
  },
  {
    path: '/connection',
    label: 'Connection',
    icon: <Link className="size-4" />,
    element: <ConnectionPage />,
    showInSidebar: true,
    group: 'main',
    roles: USER_VISIBLE
  },
  {
    path: '/lifecycle',
    label: 'Lifecycle',
    icon: <ListIcon className="size-4" />,
    element: <LifecyclePage />,
    showInSidebar: true,
    group: 'main',
    roles: ADMIN_ONLY
  },
  {
    path: '/analytics',
    label: 'Analytics',
    icon: <ChartBarIcon className="size-4" />,
    element: <AnalyticsPage />,
    showInSidebar: true,
    group: 'main',
    roles: USER_VISIBLE
  },
  {
    path: '/team',
    label: 'Team',
    icon: <UsersIcon className="size-4" />,
    element: <TeamPage />,
    showInSidebar: true,
    group: 'main',
    roles: ADMIN_ONLY
  },
  {
    path: '/groups',
    label: 'Groups',
    icon: <Layers className="size-4" />,
    element: <GroupsPage />,
    showInSidebar: true,
    group: 'settings',
    roles: ADMIN_ONLY
  },
  {
    path: '/jobs',
    label: 'Jobs',
    icon: <BriefcaseBusiness className="size-4" />,
    element: <JobsPage />,
    showInSidebar: true,
    group: 'main',
    roles: USER_VISIBLE
  },
  {
    path: '/schedule',
    label: 'Schedule',
    icon: <CalendarClock className="size-4" />,
    element: <SchedulePage />,
    showInSidebar: true,
    group: 'main',
    roles: USER_VISIBLE
  },
  {
    path: '/stores',
    label: 'Stores',
    icon: <Store className="size-4" />,
    element: <StoresPage />,
    showInSidebar: true,
    group: 'settings',
    roles: ADMIN_ONLY
  },
  {
    path: '/fiscal-years',
    label: 'Fiscal Years',
    icon: <CalendarRange className="size-4" />,
    element: <FiscalYearsPage />,
    showInSidebar: true,
    group: 'settings',
    roles: ADMIN_ONLY
  },
  {
    path: '/job-group',
    label: 'Job Group',
    icon: <Layers className="size-4" />,
    element: <JobGroupPage />,
    showInSidebar: true,
    group: 'settings',
    roles: ADMIN_ONLY
  },
  {
    path: '/create',
    label: 'Create',
    icon: <PlusIcon className="size-4" />,
    element: <CreatePage />,
    showInSidebar: false,
    roles: ADMIN_ONLY
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: <Settings className="size-4" />,
    element: <SettingsPage />,
    showInSidebar: false,
    roles: USER_VISIBLE
  }
]

export function canAccessRoute(route: RouteConfig, role: UserRole | undefined): boolean {
  if (!role) return false
  if (!route.roles) return true
  return route.roles.includes(role)
}

export function getRoutesForRole(role: UserRole | undefined): RouteConfig[] {
  return routes.filter((r) => canAccessRoute(r, role))
}

export function getSidebarNavItems(role: UserRole | undefined): Array<{
  title: string
  url: string
  icon: ReactNode
}> {
  return routes
    .filter((r) => r.showInSidebar && r.group === 'main' && canAccessRoute(r, role))
    .map((r) => ({ title: r.label, url: r.path, icon: r.icon }))
}

export function getSidebarSettingsItems(role: UserRole | undefined): Array<{
  title: string
  url: string
  icon: ReactNode
}> {
  return routes
    .filter((r) => r.showInSidebar && r.group === 'settings' && canAccessRoute(r, role))
    .map((r) => ({ title: r.label, url: r.path, icon: r.icon }))
}

// Legacy exports (kept for backwards compat — assume admin view)
export const sidebarNavItems = getSidebarNavItems('admin')
export const sidebarSettingsItems = getSidebarSettingsItems('admin')
