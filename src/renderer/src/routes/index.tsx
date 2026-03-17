import { lazy, ReactNode } from 'react'
import {
  LayoutDashboardIcon,
  ListIcon,
  ChartBarIcon,
  FolderIcon,
  UsersIcon,
  PlusIcon,
  Link,
  Layers,
  Store,
  CalendarRange
} from 'lucide-react'

// Lazy load pages — add new pages here, they auto-register in sidebar + router
const DashboardPage = lazy(() => import('@/pages/dashboard'))
const ConnectionPage = lazy(() => import('@/pages/connection'))
const LifecyclePage = lazy(() => import('@/pages/lifecycle'))
const AnalyticsPage = lazy(() => import('@/pages/analytics'))
const ProjectsPage = lazy(() => import('@/pages/projects'))
const TeamPage = lazy(() => import('@/pages/team'))
const CreatePage = lazy(() => import('@/pages/create'))
const GroupsPage = lazy(() => import('@/pages/groups'))
const StoresPage = lazy(() => import('@/pages/stores'))
const FiscalYearsPage = lazy(() => import('@/pages/fiscal-years'))

export interface RouteConfig {
  path: string
  label: string
  icon: ReactNode
  element: ReactNode
  showInSidebar?: boolean
  group?: 'main' | 'settings'
}

export const routes: RouteConfig[] = [
  {
    path: '/',
    label: 'Dashboard',
    icon: <LayoutDashboardIcon className="size-4" />,
    element: <DashboardPage />,
    showInSidebar: true,
    group: 'main'
  },
  {
    path: '/connection',
    label: 'Connection',
    icon: <Link className="size-4" />,
    element: <ConnectionPage />,
    showInSidebar: true,
    group: 'main'
  },
  {
    path: '/lifecycle',
    label: 'Lifecycle',
    icon: <ListIcon className="size-4" />,
    element: <LifecyclePage />,
    showInSidebar: true,
    group: 'main'
  },
  {
    path: '/analytics',
    label: 'Analytics',
    icon: <ChartBarIcon className="size-4" />,
    element: <AnalyticsPage />,
    showInSidebar: true,
    group: 'main'
  },
  {
    path: '/projects',
    label: 'Projects',
    icon: <FolderIcon className="size-4" />,
    element: <ProjectsPage />,
    showInSidebar: true,
    group: 'main'
  },
  {
    path: '/team',
    label: 'Team',
    icon: <UsersIcon className="size-4" />,
    element: <TeamPage />,
    showInSidebar: true,
    group: 'main'
  },
  {
    path: '/groups',
    label: 'Groups',
    icon: <Layers className="size-4" />,
    element: <GroupsPage />,
    showInSidebar: true,
    group: 'settings'
  },
  {
    path: '/stores',
    label: 'Stores',
    icon: <Store className="size-4" />,
    element: <StoresPage />,
    showInSidebar: true,
    group: 'settings'
  },
  {
    path: '/fiscal-years',
    label: 'Fiscal Years',
    icon: <CalendarRange className="size-4" />,
    element: <FiscalYearsPage />,
    showInSidebar: true,
    group: 'settings'
  },
  {
    path: '/create',
    label: 'Create',
    icon: <PlusIcon className="size-4" />,
    element: <CreatePage />,
    showInSidebar: false
  }
]

// Sidebar nav items — main section
export const sidebarNavItems = routes
  .filter((r) => r.showInSidebar && r.group === 'main')
  .map((r) => ({ title: r.label, url: r.path, icon: r.icon }))

// Sidebar settings items — settings section
export const sidebarSettingsItems = routes
  .filter((r) => r.showInSidebar && r.group === 'settings')
  .map((r) => ({ title: r.label, url: r.path, icon: r.icon }))
