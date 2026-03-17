import * as React from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden rounded-lg border border-zinc-300 bg-background shadow-2xl dark:border-zinc-700">
        <SidebarProvider className="h-full overflow-hidden">
          <AppSidebar />
          <SidebarInset className="h-full overflow-hidden">
            <SiteHeader />
            <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:p-6">
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </TooltipProvider>
  )
}
