import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from './input'

function PasswordInput({ className, ...props }: React.ComponentProps<'input'>): React.JSX.Element {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        placeholder="••••••••"
        autoComplete="new-password"
        className={cn('pr-9', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex items-center px-2.5"
        tabIndex={-1}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

export { PasswordInput }
