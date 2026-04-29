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
 * Apply a single set of credentials to many connections at once. Both fields
 * are optional — empty fields are excluded from the update so the existing
 * value on each row is preserved.
 */
export function BulkCredentialsDialog({ open, onOpenChange, count, onSubmit }: Props): JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setUsername('')
      setPassword('')
      setSubmitting(false)
    }
  }, [open])

  async function handleApply(): Promise<void> {
    const payload: { username?: string; password?: string } = {}
    if (username.length > 0) payload.username = username
    if (password.length > 0) payload.password = password
    if (!payload.username && !payload.password) return
    setSubmitting(true)
    try {
      await onSubmit(payload)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  const noChange = username.length === 0 && password.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk update credentials</DialogTitle>
          <DialogDescription>
            Apply the same username and/or password to{' '}
            <span className="font-medium text-foreground">{count}</span> selected connection(s).
            Leave a field blank to keep its current value untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-username">Username</Label>
            <Input
              id="bulk-username"
              placeholder="e.g. sa"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-password">Password</Label>
            <PasswordInput
              id="bulk-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This overwrites the credentials on every selected connection.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={submitting || noChange}>
            {submitting ? 'Applying…' : `Apply to ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
