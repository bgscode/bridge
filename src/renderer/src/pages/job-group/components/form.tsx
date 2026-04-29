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

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional()
})
export type JobGroupFormValues = z.infer<typeof schema>

const DEFAULT_FORM_VALUES: JobGroupFormValues = { name: '', description: '' }

interface JobGroupFormProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  data?: Partial<JobGroupFormValues>
  onSubmit: (values: JobGroupFormValues) => void
}

export function JobGroupForm({
  isOpen,
  onOpenChange,
  mode,
  data,
  onSubmit
}: JobGroupFormProps): JSX.Element {
  const wasOpenRef = useRef(false)
  const skipAutoSaveOnCloseRef = useRef(false)
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isSubmitting }
  } = useForm<JobGroupFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_FORM_VALUES
  })

  const createDraft = usePersistentDraft<JobGroupFormValues>('job-groups:create:form:draft:v1')

  useEffect(() => {
    if (!isOpen) return

    if (mode === 'create') {
      reset(createDraft.readDraft() ?? DEFAULT_FORM_VALUES)
      return
    }

    reset({ name: data?.name ?? '', description: data?.description ?? '' })
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

  function onValid(values: JobGroupFormValues): void {
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
          <DialogTitle>{mode === 'create' ? 'New Job Group' : 'Edit Job Group'}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? 'Add a new job group.' : 'Update job group details.'}
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <form onSubmit={handleSubmit(onValid)} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name">
                Name <span className="text-destructive">*</span>
              </FieldLabel>
              <Input id="name" placeholder="e.g. Night Batch" {...register('name')} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Input
                id="description"
                placeholder="Optional description"
                {...register('description')}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            {mode === 'create' && (
              <Button type="button" variant="destructive" size="sm" onClick={removeDraftAndClose}>
                Remove Draft
              </Button>
            )}
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {mode === 'create' ? 'Create Job Group' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
