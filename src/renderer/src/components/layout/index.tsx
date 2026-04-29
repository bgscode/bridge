import * as React from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps): React.JSX.Element {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg border border-zinc-300 bg-background shadow-2xl dark:border-zinc-700">
        {/* Header spans full width above the sidebar */}
        <SiteHeader />
        <SidebarProvider className="min-h-0 flex-1 min-w-0">
          <AppSidebar />
          <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-auto p-4 lg:p-6">
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </TooltipProvider>
  )
}
