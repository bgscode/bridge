import { lazy, ReactNode } from 'react'
import {
  LayoutDashboardIcon,
  ListIcon,
  ChartBarIcon,
  FolderIcon,
  UsersIcon,
  PlusIcon
} from 'lucide-react'

// Lazy load pages — add new pages here, they auto-register in sidebar + router
const DashboardPage = lazy(() => import('@/pages/dashboard'))
const LifecyclePage = lazy(() => import('@/pages/lifecycle'))
const AnalyticsPage = lazy(() => import('@/pages/analytics'))
const ProjectsPage = lazy(() => import('@/pages/projects'))
const TeamPage = lazy(() => import('@/pages/team'))
const CreatePage = lazy(() => import('@/pages/create'))

export interface RouteConfig {
  path: string
  label: string
  icon: ReactNode
  element: ReactNode
  showInSidebar?: boolean
}

export const routes: RouteConfig[] = [
  {
    path: '/',
    label: 'Dashboard',
    icon: <LayoutDashboardIcon className="size-4" />,
    element: <DashboardPage />,
    showInSidebar: true
  },
  {
    path: '/lifecycle',
    label: 'Lifecycle',
    icon: <ListIcon className="size-4" />,
    element: <LifecyclePage />,
    showInSidebar: true
  },
  {
    path: '/analytics',
    label: 'Analytics',
    icon: <ChartBarIcon className="size-4" />,
    element: <AnalyticsPage />,
    showInSidebar: true
  },
  {
    path: '/projects',
    label: 'Projects',
    icon: <FolderIcon className="size-4" />,
    element: <ProjectsPage />,
    showInSidebar: true
  },
  {
    path: '/team',
    label: 'Team',
    icon: <UsersIcon className="size-4" />,
    element: <TeamPage />,
    showInSidebar: true
  },
  {
    path: '/create',
    label: 'Create',
    icon: <PlusIcon className="size-4" />,
    element: <CreatePage />,
    showInSidebar: false // only accessible via Quick Create button
  }
]

// Sidebar nav items auto-generated from routes
export const sidebarNavItems = routes
  .filter((r) => r.showInSidebar)
  .map((r) => ({
    title: r.label,
    url: r.path,
    icon: r.icon
  }))
