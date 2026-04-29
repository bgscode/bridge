import * as React from 'react'

import { NavMain } from '@/components/nav-main'
import { NavSecondary } from '@/components/nav-secondary'
import { NavUser } from '@/components/nav-user'
import { Sidebar, SidebarContent, SidebarFooter } from '@/components/ui/sidebar'
import { Settings2Icon, CircleHelpIcon, SearchIcon } from 'lucide-react'
import { getSidebarNavItems, getSidebarSettingsItems } from '@/routes'
import { useAuth } from '@/contexts/auth-context'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>): React.JSX.Element {
  const { user } = useAuth()
  const navItems = getSidebarNavItems(user?.role)
  const settingsItems = getSidebarSettingsItems(user?.role)

  const navSecondary =
    user?.role === 'admin'
      ? [
          { title: 'Settings', url: '/settings', icon: <Settings2Icon /> },
          { title: 'Get Help', url: '#', icon: <CircleHelpIcon /> },
          { title: 'Search', url: '#', icon: <SearchIcon /> }
        ]
      : [
          { title: 'Settings', url: '/settings', icon: <Settings2Icon /> },
          { title: 'Get Help', url: '#', icon: <CircleHelpIcon /> }
        ]

  return (
    <Sidebar
      collapsible="none"
      className="border-r border-zinc-300 bg-background dark:border-zinc-700"
      {...props}
    >
      <SidebarContent>
        <NavMain items={navItems} />
        {settingsItems.length > 0 && <NavMain items={settingsItems} />}
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
