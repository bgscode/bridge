'use client'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/theme-provider'
import {
  Sun,
  Moon,
  Minus,
  Square,
  X,
  Maximize2,
  CommandIcon,
  RefreshCwIcon,
  Loader2Icon
} from 'lucide-react'
import { JSX, useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { connectionsApi, jobsApi, getToken } from '@/lib/api'

const isMac = window.api?.window?.platform === 'darwin'

export function SiteHeader(): JSX.Element {
  const { theme, setTheme } = useTheme()
  const { isAuthenticated } = useAuth()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    window.api.window.isFullscreen().then(setIsFullscreen)
    window.api.window.onFullscreenChange(setIsFullscreen)
    window.api.window.isMaximized().then(setIsMaximized)
    return () => window.api.window.offFullscreenChange()
  }, [])

  const handleMaximize = (): void => {
    window.api.window.maximize()
    window.api.window.isMaximized().then(setIsMaximized)
  }

  const toggleTheme = (): void => setTheme(theme === 'dark' ? 'light' : 'dark')

  const handleSync = async (): Promise<void> => {
    setSyncing(true)
    try {
      const token = getToken()
      if (!token) {
        toast.error('Please log in before syncing')
        return
      }
      const result = await window.api.sync.run(token)
      // Also refresh in-memory REST caches (for admin-only endpoints shown elsewhere)
      await Promise.all([connectionsApi.list().catch(() => []), jobsApi.list().catch(() => [])])
      const p = result.pulled
      toast.success(
        `Synced: ${p.connections} connections · ${p.jobs} jobs · ${p.stores} stores · ${p.groups} groups`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  // macOS normal window needs traffic-light clearance; fullscreen should be flush-left.
  const leftPad = isMac ? (isFullscreen ? 'pl-0' : 'pl-[80px]') : 'pl-0'

  // Windows: reserve right space for native-looking controls
  const rightPad = !isMac ? 'pr-0' : 'pr-4 lg:pr-6'

  return (
    <header
      className="sticky top-0 z-50 flex h-12 shrink-0 items-center gap-2 border-b bg-background transition-[padding,width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className={`flex w-full items-center gap-1 ${rightPad} ${leftPad}`}>
        <div className="flex-1">
          <Button variant="ghost" className="gap-2">
            <div className="flex items-center justify-center rounded-lg bg-black text-white p-1.5">
              <CommandIcon className="size-4" />
            </div>
            <span className="text-sm font-semibold ml-2">Bridge Inc.</span>
          </Button>
        </div>

        {/* Right actions — no drag */}
        <div
          className="flex items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Sync button */}
          {isAuthenticated && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 rounded-sm hover:bg-muted"
              onClick={handleSync}
              disabled={syncing}
              title="Sync with server"
            >
              {syncing ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-4" />
              )}
              <span className="text-xs">Sync</span>
            </Button>
          )}

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-sm hover:bg-muted"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            <span className="sr-only">Toggle theme</span>
          </Button>

          {/* Windows-only window controls */}
          {!isMac && (
            <div className="ml-2 flex h-12 items-stretch">
              {/* Minimize */}
              <button
                onClick={() => window.api.window.minimize()}
                className="flex w-11 items-center justify-center text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                title="Minimize"
              >
                <Minus className="size-3.5" />
              </button>

              {/* Maximize / Restore */}
              <button
                onClick={handleMaximize}
                className="flex w-11 items-center justify-center text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                title={isMaximized ? 'Restore' : 'Maximize'}
              >
                {isMaximized ? <Maximize2 className="size-3.5" /> : <Square className="size-3.5" />}
              </button>

              {/* Close */}
              <button
                onClick={() => window.api.window.close()}
                className="flex w-11 items-center justify-center text-foreground/70 transition-colors hover:bg-destructive hover:text-white"
                title="Close"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
