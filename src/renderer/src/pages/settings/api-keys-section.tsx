import { JSX, useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  apiKeysApi,
  authApi,
  getToken,
  type ApiKeyRecord,
  type ApiKeyScope,
  type AuthUser,
  type CreatedApiKey
} from '@/lib/api'
import { cn } from '@/lib/utils'

const USER_SCOPES: { id: ApiKeyScope; label: string; description: string }[] = [
  { id: 'connections:read', label: 'Read', description: 'List and get connections' },
  { id: 'connections:write', label: 'Write', description: 'Create, update, delete, bulk credentials' }
]

const ADMIN_EXTRA_SCOPES: { id: ApiKeyScope; label: string; description: string }[] = [
  {
    id: 'connections:secrets',
    label: 'Secrets',
    description: 'Include passwords when ?include_secrets=true'
  }
]

function formatDate(value: string | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export function ApiKeysSection(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState(false)

  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiKeyScope[]>([
    'connections:read',
    'connections:write'
  ])
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const hasToken = Boolean(getToken())
  const isAuthenticated = Boolean(hasToken && user)
  const isAdmin = user?.role === 'admin'

  const loadUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setAuthReady(true)
      return
    }
    try {
      const me = await authApi.me()
      setUser(me)
    } catch {
      setUser(null)
    } finally {
      setAuthReady(true)
    }
  }, [])

  const load = useCallback(async () => {
    if (!getToken()) {
      setKeys([])
      return
    }
    setLoading(true)
    try {
      const rows = await apiKeysApi.list()
      setKeys(rows)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUser().then(() => load())
  }, [loadUser, load])

  function toggleScope(scope: ApiKeyScope): void {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    )
  }

  async function handleCreate(): Promise<void> {
    if (!name.trim()) {
      toast.error('Give the key a name')
      return
    }
    if (scopes.length === 0) {
      toast.error('Select at least one scope')
      return
    }
    setCreating(true)
    try {
      const row = await apiKeysApi.create({ name: name.trim(), scopes })
      setCreatedKey(row)
      setCreateOpen(false)
      setName('')
      setScopes(['connections:read', 'connections:write'])
      await load()
      toast.success('API key created — copy it now')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create API key')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    setBusyId(id)
    try {
      await apiKeysApi.revoke(id)
      toast.success('API key revoked')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke key')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setBusyId(id)
    try {
      await apiKeysApi.remove(id)
      toast.success('API key deleted')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete key')
    } finally {
      setBusyId(null)
    }
  }

  async function copyKey(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success('Copied to clipboard')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select and copy manually')
    }
  }

  const scopeOptions = isAdmin ? [...USER_SCOPES, ...ADMIN_EXTRA_SCOPES] : USER_SCOPES

  if (!authReady) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="size-3.5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">API Keys</p>
            <p className="text-muted-foreground mt-0.5 text-xs">Loading…</p>
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="size-3.5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">API Keys</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Log in to create keys for external connection access
            </p>
          </div>
        </div>
        <p className="text-muted-foreground px-5 py-4 text-sm">Sign in to manage API keys.</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="size-3.5" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">API Keys</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Authenticate external apps against the connection API
              </p>
            </div>
          </div>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 size-3" />
            New key
          </Button>
        </div>

        {loading && keys.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">
            No API keys yet. Create one to call the connection API from outside this app.
          </p>
        ) : (
          <div className="divide-y">
            {keys.map((key) => {
              const revoked = Boolean(key.revoked_at)
              return (
                <div
                  key={key.id}
                  className="flex items-start justify-between gap-4 px-5 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{key.name}</span>
                      {revoked ? (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                          Revoked
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="h-4 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-400"
                        >
                          Active
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 font-mono text-xs">
                      {key.key_prefix}…
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Scopes: {key.scopes.join(', ') || '—'}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      Created {formatDate(key.created_at)} · Last used{' '}
                      {formatDate(key.last_used_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {!revoked && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId === key.id}
                        onClick={() => void handleRevoke(key.id)}
                      >
                        Revoke
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busyId === key.id}
                      onClick={() => void handleDelete(key.id)}
                      aria-label="Delete API key"
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The full key is shown only once. Use it as{' '}
              <code className="text-xs">X-API-Key</code> on connection API requests.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                placeholder="e.g. Production automation"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Scopes</Label>
              {scopeOptions.map((opt) => {
                const checked = scopes.includes(opt.id)
                return (
                  <label
                    key={opt.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5',
                      checked ? 'border-primary/40 bg-primary/5' : 'border-border'
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleScope(opt.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{opt.label}</span>
                      <span className="text-muted-foreground block text-xs">
                        {opt.description}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={creating} onClick={() => void handleCreate()}>
              {creating ? 'Creating…' : 'Create key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(createdKey)}
        onOpenChange={(open) => {
          if (!open) {
            setCreatedKey(null)
            setCopied(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy your API key</DialogTitle>
            <DialogDescription>
              {createdKey?.warning ??
                'Store this key now. You will not be able to see it again.'}
            </DialogDescription>
          </DialogHeader>

          {createdKey && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">
                  {createdKey.key}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => void copyKey(createdKey.key)}
                >
                  {copied ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Example:{' '}
                <code className="text-[11px]">
                  curl -H &quot;X-API-Key: {createdKey.key_prefix}…&quot;{' '}
                  https://link.yonolight.com/api/connections
                </code>
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setCreatedKey(null)
                setCopied(false)
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
