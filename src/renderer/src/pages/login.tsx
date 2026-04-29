import { useState, type FormEvent } from 'react'
import { Loader2Icon, CommandIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { useAuth } from '@/contexts/auth-context'

export default function LoginPage(): React.JSX.Element {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [userId, setUserId] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (mode === 'bootstrap') {
        await register({
          userId,
          name,
          phone,
          email: email.trim() || undefined,
          password
        })
        toast.success('Admin account created. Please log in.')
        setMode('login')
        setIdentifier(userId)
        setUserId('')
        setName('')
        setPhone('')
        setEmail('')
      } else {
        await login(identifier, password)
        toast.success('Welcome back')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-background p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-8 shadow-lg"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-black text-white p-2">
            <CommandIcon className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">Bridge Inc.</h1>
          <p className="text-sm text-muted-foreground">
            {mode === 'bootstrap' ? 'Create the first admin account' : 'Sign in to continue'}
          </p>
        </div>

        {mode === 'bootstrap' ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="userId">User ID</Label>
              <Input
                id="userId"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g. admin"
                required
                autoFocus
                minLength={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Mobile number"
                required
                minLength={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">
                Email <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="identifier">User ID, Phone or Email</Label>
            <Input
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Enter your user ID, phone or email"
              required
              autoFocus
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'bootstrap' ? 8 : 1}
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          {mode === 'bootstrap' ? 'Create admin account' : 'Sign in'}
        </Button>

        <button
          type="button"
          className="w-full text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setMode(mode === 'login' ? 'bootstrap' : 'login')}
        >
          {mode === 'login' ? 'First-time setup? Create admin account' : 'Back to sign in'}
        </button>
      </form>
    </div>
  )
}
