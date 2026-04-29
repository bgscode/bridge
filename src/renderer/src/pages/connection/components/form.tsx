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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Separator } from '@/components/ui/separator'
import { SelectBox } from '@/components/select-box'
import { ScrollArea } from '@/components/ui/scroll-area'
import { JSX, ReactNode, useEffect, useRef } from 'react'
import { ConnectionRow } from '@shared/index'
import { useGroups, useStores, useFiscalYears } from '@/contexts'
import { usePersistentDraft } from '@/hooks/use-persistent-draft'

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  static_ip: z.string().min(1, 'Static IP is required'),
  vpn_ip: z.string().min(1, 'VPN IP is required'),
  db_name: z.string().min(1, 'Database is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional().default(''),
  trust_cert: z.boolean().default(false),
  store_id: z.number().nullable().optional(),
  fiscal_year_id: z.number({ error: 'Financial Year is required' }),
  group_id: z.number({ error: 'Group is required' })
})

export type ConnectionFormValues = z.input<typeof formSchema>

const DEFAULT_FORM_VALUES: Partial<ConnectionFormValues> = {
  name: '',
  static_ip: '',
  vpn_ip: '',
  db_name: '',
  username: '',
  password: '',
  trust_cert: false,
  store_id: undefined,
  fiscal_year_id: undefined,
  group_id: undefined
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeConnectionDraft(
  draft: Partial<ConnectionFormValues>
): Partial<ConnectionFormValues> {
  return {
    ...draft,
    group_id: toOptionalNumber(draft.group_id),
    fiscal_year_id: toOptionalNumber(draft.fiscal_year_id),
    store_id: toNullableNumber(draft.store_id)
  }
}

interface ConnectionFormProps {
  data?: ConnectionRow
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  onSubmit?: (values: ConnectionFormValues) => void
}

function FormSection({
  step,
  title,
  description,
  children
}: {
  step: number
  title: string
  description: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {step}
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>
      <div className="flex flex-1 flex-col gap-3 pb-4">
        <div>
          <p className="text-sm font-medium leading-none">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ConnectionForm({
  data,
  isOpen,
  onOpenChange,
  mode,
  onSubmit: onSubmitProp
}: ConnectionFormProps): JSX.Element {
  const { groups } = useGroups()
  const { stores } = useStores()
  const { fiscalYears } = useFiscalYears()
  const isEdit = mode === 'edit'

  const wasOpenRef = useRef(false)
  const skipAutoSaveOnCloseRef = useRef(false)
  const createDraft = usePersistentDraft<Partial<ConnectionFormValues>>(
    'connection:create:form:draft:v1'
  )

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    getValues,
    formState: { errors, isSubmitting }
  } = useForm<ConnectionFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULT_FORM_VALUES
  })

  useEffect(() => {
    if (!isOpen) return

    if (!isEdit) {
      const draft = createDraft.readDraft()
      reset(
        draft ? { ...DEFAULT_FORM_VALUES, ...normalizeConnectionDraft(draft) } : DEFAULT_FORM_VALUES
      )
      return
    }

    if (data) {
      reset({
        name: data.name,
        static_ip: data.static_ip,
        vpn_ip: data.vpn_ip,
        db_name: data.db_name,
        username: data.username,
        password: data.password ?? '',
        trust_cert: data.trust_cert === 1,
        store_id: data.store_id ?? undefined,
        fiscal_year_id: data.fiscal_year_id ?? undefined,
        group_id: data.group_id ?? undefined
      })
    } else {
      reset(DEFAULT_FORM_VALUES)
    }
  }, [isOpen, isEdit, data, reset, createDraft])

  useEffect(() => {
    const wasOpen = wasOpenRef.current

    if (!isEdit && wasOpen && !isOpen && !skipAutoSaveOnCloseRef.current) {
      createDraft.saveDraft(normalizeConnectionDraft(getValues()))
    }

    if (!isOpen && skipAutoSaveOnCloseRef.current) {
      skipAutoSaveOnCloseRef.current = false
    }

    wasOpenRef.current = isOpen
  }, [isOpen, isEdit, createDraft, getValues])

  useEffect(() => {
    return () => {
      if (!isEdit && isOpen && !skipAutoSaveOnCloseRef.current) {
        createDraft.saveDraft(normalizeConnectionDraft(getValues()))
      }
    }
  }, [isEdit, isOpen, createDraft, getValues])

  const trust_cert = watch('trust_cert')

  function onSubmit(values: ConnectionFormValues): void {
    onSubmitProp?.(values)

    if (!isEdit) {
      skipAutoSaveOnCloseRef.current = true
      createDraft.clearDraft()
    }

    reset(DEFAULT_FORM_VALUES)
    onOpenChange(false)
  }

  function removeDraftAndClose(): void {
    if (!isEdit) {
      skipAutoSaveOnCloseRef.current = true
      createDraft.clearDraft()
    }

    reset(DEFAULT_FORM_VALUES)
    onOpenChange(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden w-full sm:min-w-2xl max-w-4xl flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle>{isEdit ? 'Edit Connection' : 'New Connection'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update your database connection details.'
              : 'Configure a new database connection.'}
          </DialogDescription>
        </DialogHeader>
        <Separator className="mt-0" />

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1 overflow-auto">
            <div className="flex flex-col gap-0 px-6 py-4">
              <FormSection
                step={1}
                title="Basic Info"
                description="Name your connection and assign it to a group"
              >
                <FieldGroup>
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

                  <Field data-invalid={!!errors.group_id}>
                    <FieldLabel htmlFor="group_id">
                      Group <span className="text-destructive">*</span>
                    </FieldLabel>
                    <SelectBox
                      options={groups.map((g) => ({ value: g.id, label: g.name }))}
                      value={watch('group_id') ?? null}
                      onChange={(val) => {
                        const next = toOptionalNumber(val)
                        if (next !== undefined) {
                          setValue('group_id', next, { shouldValidate: true })
                        }
                      }}
                      placeholder="Select a group"
                      error={!!errors.group_id}
                      aria-label="Group"
                    />
                    <FieldError errors={[errors.group_id]} />
                  </Field>
                </FieldGroup>
              </FormSection>

              <FormSection
                step={2}
                title="Network"
                description="Enter static and VPN endpoints for this database"
              >
                <div className="grid grid-cols-2 gap-2">
                  <Field data-invalid={!!errors.static_ip}>
                    <FieldLabel htmlFor="static_ip">
                      Static IP <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input
                      id="static_ip"
                      placeholder="e.g. 192.168.1.100"
                      aria-invalid={!!errors.static_ip}
                      {...register('static_ip')}
                    />
                    <FieldError errors={[errors.static_ip]} />
                  </Field>

                  <Field data-invalid={!!errors.vpn_ip}>
                    <FieldLabel htmlFor="vpn_ip">
                      VPN IP <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input
                      id="vpn_ip"
                      placeholder="e.g. 10.8.0.5"
                      aria-invalid={!!errors.vpn_ip}
                      {...register('vpn_ip')}
                    />
                    <FieldError errors={[errors.vpn_ip]} />
                  </Field>
                </div>
              </FormSection>

              <FormSection
                step={3}
                title="Database Credentials"
                description="Provide database name and login credentials"
              >
                <FieldGroup>
                  <Field data-invalid={!!errors.db_name}>
                    <FieldLabel htmlFor="db_name">
                      Database Name <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input
                      id="db_name"
                      placeholder="e.g. company_db"
                      aria-invalid={!!errors.db_name}
                      {...register('db_name')}
                    />
                    <FieldError errors={[errors.db_name]} />
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
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

                    <Field>
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <PasswordInput id="password" {...register('password')} />
                    </Field>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2">
                    <div>
                      <p className="text-xs font-medium">Trust Server Certificate</p>
                      <p className="text-xs text-muted-foreground">
                        Allow self-signed or unverified certificates
                      </p>
                    </div>
                    <Checkbox
                      id="trust_cert"
                      checked={trust_cert}
                      onCheckedChange={(checked) =>
                        setValue('trust_cert', !!checked, { shouldValidate: true })
                      }
                    />
                  </div>
                </FieldGroup>
              </FormSection>

              <FormSection
                step={4}
                title="Business Mapping"
                description="Map this connection to financial year and store"
              >
                <div className="grid grid-cols-2 gap-2">
                  <Field data-invalid={!!errors.fiscal_year_id}>
                    <FieldLabel htmlFor="fiscal_year_id">
                      Financial Year <span className="text-destructive">*</span>
                    </FieldLabel>
                    <SelectBox
                      options={fiscalYears.map((fy) => ({ value: fy.id, label: fy.name }))}
                      value={watch('fiscal_year_id') ?? null}
                      onChange={(val) => {
                        const next = toOptionalNumber(val)
                        if (next !== undefined) {
                          setValue('fiscal_year_id', next, { shouldValidate: true })
                        }
                      }}
                      placeholder="Select year"
                      error={!!errors.fiscal_year_id}
                      aria-label="Financial Year"
                    />
                    <FieldError errors={[errors.fiscal_year_id]} />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="store_id">Store</FieldLabel>
                    <SelectBox
                      options={stores.map((s) => ({ value: s.id, label: s.name }))}
                      value={watch('store_id') ?? null}
                      onChange={(val) => {
                        setValue('store_id', toNullableNumber(val), { shouldValidate: true })
                      }}
                      placeholder="Select a store"
                      clearable
                      aria-label="Store"
                    />
                  </Field>
                </div>
              </FormSection>
            </div>
          </ScrollArea>

          <DialogFooter className="px-6 mb-0">
            {!isEdit && (
              <Button type="button" variant="destructive" size="sm" onClick={removeDraftAndClose}>
                Remove Draft
              </Button>
            )}
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Connection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default ConnectionForm
