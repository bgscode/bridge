import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { JSX, useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
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
import { Separator } from '@/components/ui/separator'
import { usePersistentDraft } from '@/hooks/use-persistent-draft'

// ─── Schema ────────────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().min(1, 'Code is required')
})
export type StoreFormValues = z.infer<typeof schema>

const DEFAULT_FORM_VALUES: StoreFormValues = { name: '', code: '' }

// ─── Props ─────────────────────────────────────────────────────────────────────

interface StoreFormProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  data?: Partial<StoreFormValues>
  onSubmit: (values: StoreFormValues) => void
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function StoreForm({
  isOpen,
  onOpenChange,
  mode,
  data,
  onSubmit
}: StoreFormProps): JSX.Element {
  const wasOpenRef = useRef(false)
  const skipAutoSaveOnCloseRef = useRef(false)
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isSubmitting }
  } = useForm<StoreFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_FORM_VALUES
  })

  const createDraft = usePersistentDraft<StoreFormValues>('stores:create:form:draft:v1')

  useEffect(() => {
    if (!isOpen) return

    if (mode === 'create') {
      reset(createDraft.readDraft() ?? DEFAULT_FORM_VALUES)
      return
    }

    reset({ name: data?.name ?? '', code: data?.code ?? '' })
  }, [isOpen, mode, data, reset, createDraft])

  useEffect(() => {
    const wasOpen = wasOpenRef.current

    if (mode === 'create' && wasOpen && !isOpen && !skipAutoSaveOnCloseRef.current) {
      createDraft.saveDraft(getValues())
    }

    if (!isOpen && skipAutoSaveOnCloseRef.current) {
      skipAutoSaveOnCloseRef.current = false
    }

    wasOpenRef.current = isOpen
  }, [isOpen, mode, createDraft, getValues])

  function onValid(values: StoreFormValues): void {
    onSubmit(values)
    if (mode === 'create') {
      skipAutoSaveOnCloseRef.current = true
      createDraft.clearDraft()
    }
    reset(DEFAULT_FORM_VALUES)
    onOpenChange(false)
  }

  function removeDraftAndClose(): void {
    if (mode === 'create') {
      skipAutoSaveOnCloseRef.current = true
      createDraft.clearDraft()
    }
    reset(DEFAULT_FORM_VALUES)
    onOpenChange(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Store' : 'Edit Store'}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? 'Add a new store.' : 'Update store details.'}
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name">
                Name <span className="text-destructive">*</span>
              </FieldLabel>
              <Input id="name" placeholder="e.g. Main Store" {...register('name')} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.code}>
              <FieldLabel htmlFor="code">
                Code <span className="text-destructive">*</span>
              </FieldLabel>
              <Input id="code" placeholder="e.g. STR-001" {...register('code')} />
              <FieldError errors={[errors.code]} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            {mode === 'create' && (
              <Button type="button" variant="destructive" size="sm" onClick={removeDraftAndClose}>
                Remove Draft
              </Button>
            )}
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {mode === 'create' ? 'Create Store' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
