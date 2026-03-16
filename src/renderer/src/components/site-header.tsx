'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useSidebar } from '@/components/ui/sidebar'
import { Menu, Minus, Square, X, Maximize2 } from 'lucide-react'

export function SiteHeader() {
  const [isMaximized, setIsMaximized] = useState(false)
  const { toggleSidebar } = useSidebar()

  useEffect(() => {
    window.api.window.isMaximized().then(setIsMaximized)
  }, [])

  const handleMinimize = () => window.api.window.minimize()
  const handleMaximize = () => {
    window.api.window.maximize()
    window.api.window.isMaximized().then(setIsMaximized)
  }
  const handleClose = () => window.api.window.close()

  return (
    <header
      className="sticky top-0 z-50 flex h-12 shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        {/* Hamburger sidebar toggle — no drag */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Button variant="ghost" size="icon" className="-ml-1 h-8 w-8" onClick={toggleSidebar}>
            <Menu className="size-4" />
            <span className="sr-only">Toggle Sidebar</span>
          </Button>
        </div>
        <h1 className="text-base font-medium flex-1">Bridge</h1>

        {/* Window control buttons — no drag */}
        <div
          className="flex items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-sm hover:bg-muted"
            onClick={handleMinimize}
          >
            <Minus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-sm hover:bg-muted"
            onClick={handleMaximize}
          >
            {isMaximized ? <Maximize2 className="size-3.5" /> : <Square className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-sm hover:bg-destructive hover:text-destructive-foreground"
            onClick={handleClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </header>
  )
}
