import { JSX, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  onSubmit: (creds: { username?: string; password?: string }) => Promise<void> | void
}

/**
 * Apply username and/or password to selected connections.
 * Tick which fields to update — unchecked fields stay as they are.
 */
export function BulkCredentialsDialog({ open, onOpenChange, count, onSubmit }: Props): JSX.Element {
  const [updateUsername, setUpdateUsername] = useState(false)
  const [updatePassword, setUpdatePassword] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setUpdateUsername(false)
      setUpdatePassword(true)
      setUsername('')
      setPassword('')
      setSubmitting(false)
    }
  }, [open])

  async function handleApply(): Promise<void> {
    const payload: { username?: string; password?: string } = {}
    if (updateUsername) payload.username = username.trim()
    if (updatePassword) payload.password = password
    if (payload.username === undefined && payload.password === undefined) return
    if (updateUsername && !payload.username) return
    if (updatePassword && payload.password === undefined) return

    setSubmitting(true)
    try {
      await onSubmit(payload)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  const usernameOk = !updateUsername || username.trim().length > 0
  const passwordOk = !updatePassword || password.length > 0
  const canApply =
    (updateUsername || updatePassword) && usernameOk && passwordOk && !submitting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk update credentials</DialogTitle>
          <DialogDescription>
            Update credentials on{' '}
            <span className="font-medium text-foreground">{count}</span> selected connection(s).
            Tick only the fields you want to change.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="bulk-update-username"
                checked={updateUsername}
                onCheckedChange={(v) => setUpdateUsername(v === true)}
              />
              <Label htmlFor="bulk-update-username" className="cursor-pointer">
                Update username
              </Label>
            </div>
            <Input
              id="bulk-username"
              placeholder="e.g. SA"
              autoComplete="off"
              disabled={!updateUsername}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="bulk-update-password"
                checked={updatePassword}
                onCheckedChange={(v) => setUpdatePassword(v === true)}
              />
              <Label htmlFor="bulk-update-password" className="cursor-pointer">
                Update password
              </Label>
            </div>
            <PasswordInput
              id="bulk-password"
              autoComplete="new-password"
              disabled={!updatePassword}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Unticked fields keep their current value on every selected connection.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!canApply}>
            {submitting ? 'Applying…' : `Apply to ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
