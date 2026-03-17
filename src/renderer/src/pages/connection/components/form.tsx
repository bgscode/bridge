import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

// ─── Schema ────────────────────────────────────────────────────────────────────

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  staticIp: z.string().min(1, 'Static IP is required'),
  vpnIp: z.string().min(1, 'VPN IP is required'),
  database: z.string().min(1, 'Database is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  trustServerCertificate: z.boolean().default(false),
  store: z.string().optional(),
  financialYear: z.string().min(1, 'Financial Year is required'),
  group: z.string().min(1, 'Group is required')
})

export type ConnectionFormValues = z.output<typeof formSchema>

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ConnectionFormProps {
  data?: Partial<ConnectionFormValues>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  onSubmit?: (values: ConnectionFormValues) => void
}

// ─── Static Options ────────────────────────────────────────────────────────────

const FINANCIAL_YEARS = ['2024-25', '2025-26', '2026-27', '2027-28']

const GROUPS = ['Head Office', 'Branch', 'Warehouse', 'Remote Site']

// ─── Component ─────────────────────────────────────────────────────────────────

export function ConnectionForm({
  data,
  isOpen,
  onOpenChange,
  mode,
  onSubmit: onSubmitProp
}: ConnectionFormProps) {
  const isEdit = mode === 'edit'

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      staticIp: '',
      vpnIp: '',
      database: '',
      username: '',
      password: '',
      trustServerCertificate: false as boolean,
      store: '',
      financialYear: '',
      group: '',
      ...data
    }
  })

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting }
  } = form

  const trustServerCertificate = watch('trustServerCertificate')

  function onSubmit(values: ConnectionFormValues) {
    onSubmitProp?.(values)
    reset()
    onOpenChange(false)
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset()
    onOpenChange(open)
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] w-full sm:min-w-3xl max-w-4xl overflow-y-auto">
        {/* Header */}
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {isEdit ? 'Edit Connection' : 'New Connection'}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {isEdit
              ? 'Update the details of your existing connection.'
              : 'Fill in the details to create a new database connection.'}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
          {/* Section — Identity */}
          <FieldSet>
            <FieldLegend variant="label">General</FieldLegend>
            <FieldGroup>
              {/* Name */}
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="name">
                  Connection Name <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  id="name"
                  placeholder="e.g. Head Office Production"
                  aria-invalid={!!errors.name}
                  {...register('name')}
                />
                <FieldError errors={[errors.name]} />
              </Field>

              {/* Group */}
              <Field data-invalid={!!errors.group}>
                <FieldLabel htmlFor="group">
                  Group <span className="text-destructive">*</span>
                </FieldLabel>
                <Select
                  value={watch('group')}
                  onValueChange={(val) => setValue('group', val, { shouldValidate: true })}
                >
                  <SelectTrigger id="group" className="w-full" aria-invalid={!!errors.group}>
                    <SelectValue placeholder="Select a group" />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUPS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={[errors.group]} />
              </Field>
            </FieldGroup>
          </FieldSet>

          {/* Section — Network */}
          <FieldSet>
            <FieldLegend variant="label">Network</FieldLegend>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                {/* Static IP */}
                <Field data-invalid={!!errors.staticIp}>
                  <FieldLabel htmlFor="staticIp">
                    Static IP <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="staticIp"
                    placeholder="e.g. 192.168.1.100"
                    aria-invalid={!!errors.staticIp}
                    {...register('staticIp')}
                  />
                  <FieldError errors={[errors.staticIp]} />
                </Field>

                {/* VPN IP */}
                <Field data-invalid={!!errors.vpnIp}>
                  <FieldLabel htmlFor="vpnIp">
                    VPN IP <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="vpnIp"
                    placeholder="e.g. 10.8.0.5"
                    aria-invalid={!!errors.vpnIp}
                    {...register('vpnIp')}
                  />
                  <FieldError errors={[errors.vpnIp]} />
                </Field>
              </div>
            </FieldGroup>
          </FieldSet>

          {/* Section — Database */}
          <FieldSet>
            <FieldLegend variant="label">Database</FieldLegend>
            <FieldGroup>
              {/* Database Name */}
              <Field data-invalid={!!errors.database}>
                <FieldLabel htmlFor="database">
                  Database Name <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  id="database"
                  placeholder="e.g. company_db"
                  aria-invalid={!!errors.database}
                  {...register('database')}
                />
                <FieldError errors={[errors.database]} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                {/* Username */}
                <Field data-invalid={!!errors.username}>
                  <FieldLabel htmlFor="username">
                    Username <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="username"
                    placeholder="e.g. sa"
                    autoComplete="off"
                    aria-invalid={!!errors.username}
                    {...register('username')}
                  />
                  <FieldError errors={[errors.username]} />
                </Field>

                {/* Password */}
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    {...register('password')}
                  />
                </Field>
              </div>

              {/* Trust Server Certificate */}
              <Field orientation="horizontal">
                <Checkbox
                  id="trustServerCertificate"
                  checked={trustServerCertificate}
                  onCheckedChange={(checked) =>
                    setValue('trustServerCertificate', !!checked, { shouldValidate: true })
                  }
                />
                <FieldLabel htmlFor="trustServerCertificate" className="font-normal leading-none">
                  Trust Server Certificate
                </FieldLabel>
              </Field>
            </FieldGroup>
          </FieldSet>

          {/* Section — Business */}
          <FieldSet>
            <FieldLegend variant="label">Business</FieldLegend>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                {/* Financial Year */}
                <Field data-invalid={!!errors.financialYear}>
                  <FieldLabel htmlFor="financialYear">
                    Financial Year <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Select
                    value={watch('financialYear')}
                    onValueChange={(val) =>
                      setValue('financialYear', val, { shouldValidate: true })
                    }
                  >
                    <SelectTrigger
                      id="financialYear"
                      className="w-full"
                      aria-invalid={!!errors.financialYear}
                    >
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                      {FINANCIAL_YEARS.map((fy) => (
                        <SelectItem key={fy} value={fy}>
                          {fy}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={[errors.financialYear]} />
                </Field>

                {/* Store */}
                <Field>
                  <FieldLabel htmlFor="store">Store</FieldLabel>
                  <Input id="store" placeholder="e.g. Main Store" {...register('store')} />
                </Field>
              </div>
            </FieldGroup>
          </FieldSet>

          <Separator />

          {/* Footer */}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Connection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default ConnectionForm
