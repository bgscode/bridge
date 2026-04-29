import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { JSX, useEffect, useRef, useState } from 'react'
import { FileText, FolderOpen, Plus, Trash2 } from 'lucide-react'

import { cn, getSpreadsheetId } from '@/lib/utils'
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
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SelectBox } from '@/components/select-box'
import { useConnections, useFiscalYears, useGroups, useJobGroups, useStores } from '@/contexts'
import { usePersistentDraft } from '@/hooks/use-persistent-draft'

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional().nullable(),
    job_group_id: z.number().optional().nullable(),
    type: z.enum(['query', 'action']),
    online_only: z.boolean(),
    is_multi: z.boolean(),
    connection_ids: z.array(z.number()).min(1, 'At least one connection is required'),
    sql_query: z.array(z.string().min(1, 'Query cannot be empty')),
    sql_query_names: z.array(z.string()).optional(),
    destination_type: z.enum(['api', 'google_sheets', 'excel']).nullable().optional(),
    destination_config: z.string().optional().nullable(),
    operation: z.enum(['append', 'replace']).nullable().optional(),
    notify_webhook: z.string().url('Must be a valid URL').optional().nullable().or(z.literal('')),
    // Destination sub-fields — serialized into destination_config on submit
    api_endpoint: z.string().optional().nullable(),
    api_method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).optional().nullable(),
    api_headers: z.string().optional().nullable(),
    sheet_id: z.string().optional().nullable(),
    sheet_name: z.string().optional().nullable(),
    sheet_credentials: z.string().optional().nullable(),
    excel_path: z.string().optional().nullable(),
    template_path: z.string().optional().nullable(),
    template_mode: z.enum(['new', 'existing']).nullable().optional(),
    // Action destination config
    action_file_path: z.string().optional().nullable(),
    action_file_name: z.string().optional().nullable(),
    action_sheet_name: z.string().optional().nullable(),
    action_target_table: z.string().optional().nullable(),
    action_mode: z.enum(['insert', 'update', 'upsert']).optional().nullable(),
    action_key_columns: z.string().optional().nullable(),
    action_batch_size: z.number().optional().nullable(),
    action_column_mapping: z.string().optional().nullable(),
    // Schedule — serialized into schedule JSON on submit
    schedule_enabled: z.boolean(),
    schedule_type: z
      .enum(['once', 'daily', 'weekly', 'monthly', 'interval', 'cron'])
      .optional()
      .nullable(),
    schedule_time: z.string().optional().nullable(), // HH:MM for daily/weekly/monthly/once
    schedule_days: z.array(z.number()).optional().nullable(), // 0-6 for weekly
    schedule_date: z.string().optional().nullable(), // YYYY-MM-DD for once/monthly
    schedule_interval_value: z.number().optional().nullable(), // numeric value
    schedule_interval_unit: z.enum(['minutes', 'hours']).optional().nullable(),
    schedule_cron: z.string().optional().nullable(),
    schedule_repeat_count: z.number().optional().nullable() // 0 = unlimited
  })
  .refine((v) => !v.is_multi || v.connection_ids.length <= 1, {
    path: ['connection_ids'],
    message: 'Multi-query mode supports only one connection'
  })

export type JobFormValues = z.infer<typeof schema>

const DEFAULT_FORM_VALUES: JobFormValues = {
  name: '',
  description: '',
  job_group_id: null,
  type: 'query',
  online_only: false,
  is_multi: false,
  connection_ids: [],
  sql_query: [''],
  sql_query_names: [],
  destination_type: null,
  destination_config: null,
  operation: null,
  notify_webhook: '',
  api_endpoint: '',
  api_method: 'POST',
  api_headers: '',
  sheet_id: '',
  sheet_name: 'Sheet1',
  sheet_credentials: '',
  excel_path: '',
  template_path: null,
  template_mode: null,
  action_file_path: '',
  action_file_name: '',
  action_sheet_name: '',
  action_target_table: '',
  action_mode: 'upsert',
  action_key_columns: 'id',
  action_batch_size: 1000,
  action_column_mapping: '',
  schedule_enabled: false,
  schedule_type: 'daily',
  schedule_time: '08:00',
  schedule_days: [],
  schedule_date: '',
  schedule_interval_value: 30,
  schedule_interval_unit: 'minutes',
  schedule_cron: '',
  schedule_repeat_count: 0
}

// ─── Schedule helpers ─────────────────────────────────────────────────────────

type ScheduleDefaults = {
  schedule_enabled: boolean
  schedule_type: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'cron'
  schedule_time: string
  schedule_days: number[]
  schedule_date: string
  schedule_interval_value: number
  schedule_interval_unit: 'minutes' | 'hours'
  schedule_cron: string
  schedule_repeat_count: number
}

function toGoogleSheetTabName(value: string): string {
  const cleaned = value
    .replace(/\\|\/|\?|\*|\[|\]|:/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Google Sheets tab names must be non-empty and <= 100 chars.
  return cleaned.slice(0, 100)
}

function normalizeNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeNumberArray(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => normalizeNumber(value))
    .filter((value): value is number => value !== null)
}

function normalizeJobDraft(draft: JobFormValues): JobFormValues {
  return {
    ...draft,
    job_group_id: normalizeNumber(draft.job_group_id),
    connection_ids: normalizeNumberArray(draft.connection_ids),
    schedule_days: normalizeNumberArray(draft.schedule_days ?? []),
    schedule_interval_value:
      normalizeNumber(draft.schedule_interval_value) ?? DEFAULT_FORM_VALUES.schedule_interval_value,
    schedule_repeat_count:
      normalizeNumber(draft.schedule_repeat_count) ?? DEFAULT_FORM_VALUES.schedule_repeat_count
  }
}

function parseSchedule(raw?: string | null): ScheduleDefaults {
  const defaults: ScheduleDefaults = {
    schedule_enabled: false,
    schedule_type: 'daily',
    schedule_time: '08:00',
    schedule_days: [],
    schedule_date: '',
    schedule_interval_value: 30,
    schedule_interval_unit: 'minutes',
    schedule_cron: '',
    schedule_repeat_count: 0
  }
  if (!raw) return defaults
  try {
    const p = JSON.parse(raw)
    return {
      schedule_enabled: true,
      schedule_type: p.type ?? 'daily',
      schedule_time: p.time ?? '08:00',
      schedule_days: p.days ?? [],
      schedule_date: p.date ?? '',
      schedule_interval_value: p.intervalValue ?? 30,
      schedule_interval_unit: p.intervalUnit ?? 'minutes',
      schedule_cron: p.cron ?? '',
      schedule_repeat_count: p.repeatCount ?? 0
    }
  } catch {
    return defaults
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface JobFormProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  data?: Partial<JobFormValues> & { schedule_raw?: string | null }
  onSubmit: (values: JobFormValues) => void
}

type ActionStagedUpload = {
  uploadId: string
  stagedPath: string
  filename: string
}

type ActionFilePreview = {
  fileType: 'csv' | 'xlsx'
  headers: string[]
  sampleRows: Record<string, unknown>[]
  totalSampledRows: number
  sheetNames?: string[]
  activeSheet?: string
}

// ─── Column mapping helpers ───────────────────────────────────────────────────

function parseMappingJson(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function countMappedTargets(raw: string | null | undefined, headers: string[]): number {
  const mapping = parseMappingJson(raw)
  let count = 0
  for (const h of headers) {
    const target = (mapping[h] ?? '').trim()
    if (target.length > 0) count += 1
  }
  return count
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function FormSection({
  step,
  title,
  description,
  children
}: {
  step: number
  title: string
  description: string
  children: React.ReactNode
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

// ─── Component ────────────────────────────────────────────────────────────────

interface ColumnMappingDialogProps {
  onOpenChange: (open: boolean) => void
  sourceHeaders: string[]
  initialMapping: Record<string, string>
  keyColumns: string[]
  onSave: (mapping: Record<string, string>) => void
}

function ColumnMappingDialog({
  onOpenChange,
  sourceHeaders,
  initialMapping,
  keyColumns,
  onSave
}: ColumnMappingDialogProps): JSX.Element {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {}
    for (const h of sourceHeaders) {
      seeded[h] = initialMapping[h] ?? h
    }
    return seeded
  })

  const targetValues = Object.values(draft)
    .map((v) => v.trim())
    .filter(Boolean)
  const duplicates = new Set(
    targetValues.filter((v, i, arr) => arr.indexOf(v) !== i).map((v) => v.toLowerCase())
  )
  const missingKeys = keyColumns.filter(
    (k) => !targetValues.some((t) => t.toLowerCase() === k.toLowerCase())
  )

  function applyIdentity(): void {
    const next: Record<string, string> = {}
    for (const h of sourceHeaders) next[h] = h
    setDraft(next)
  }

  function clearAll(): void {
    const next: Record<string, string> = {}
    for (const h of sourceHeaders) next[h] = ''
    setDraft(next)
  }

  function handleSave(): void {
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(draft)) {
      const trimmed = (v ?? '').trim()
      if (trimmed.length > 0) cleaned[k] = trimmed
    }
    onSave(cleaned)
    onOpenChange(false)
  }

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Map Columns</DialogTitle>
          <DialogDescription>
            Map each source column from the file to a target database column. Leave a target empty
            to skip that column during write.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={applyIdentity}>
            Auto-fill (identity)
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={clearAll}>
            Clear all
          </Button>
          <div className="ml-auto text-xs text-muted-foreground">
            {targetValues.length}/{sourceHeaders.length} mapped
          </div>
        </div>

        <ScrollArea className="max-h-[50vh] rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr>
                <th className="w-1/2 border-b px-3 py-2 text-left font-medium">Source column</th>
                <th className="w-1/2 border-b px-3 py-2 text-left font-medium">Target DB column</th>
              </tr>
            </thead>
            <tbody>
              {sourceHeaders.map((header) => {
                const target = draft[header] ?? ''
                const lc = target.trim().toLowerCase()
                const isDup = lc.length > 0 && duplicates.has(lc)
                return (
                  <tr key={header} className="border-b last:border-b-0">
                    <td className="px-3 py-1.5 font-mono">{header}</td>
                    <td className="px-3 py-1.5">
                      <Input
                        value={target}
                        placeholder="(skip)"
                        className={cn(
                          'h-7 font-mono text-xs',
                          isDup && 'border-destructive focus-visible:ring-destructive'
                        )}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [header]: e.target.value }))
                        }
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ScrollArea>

        {(duplicates.size > 0 || missingKeys.length > 0) && (
          <div className="space-y-1 text-xs">
            {duplicates.size > 0 && (
              <p className="text-destructive">
                Duplicate target columns: {Array.from(duplicates).join(', ')}
              </p>
            )}
            {missingKeys.length > 0 && (
              <p className="text-amber-600 dark:text-amber-400">
                Key column(s) not present in targets: {missingKeys.join(', ')}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={duplicates.size > 0}>
            Save mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function JobForm({ isOpen, onOpenChange, mode, data, onSubmit }: JobFormProps): JSX.Element {
  const { connections } = useConnections()
  const { groups } = useGroups()
  const { jobGroups } = useJobGroups()
  const { stores } = useStores()
  const { fiscalYears } = useFiscalYears()
  const wasOpenRef = useRef(false)
  const skipAutoSaveOnCloseRef = useRef(false)
  const preserveStagedOnCloseRef = useRef(false)
  const createDraft = usePersistentDraft<JobFormValues>('jobs:create:form:draft:v1')

  const {
    register,
    handleSubmit,
    reset,
    control,
    getValues,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<JobFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_FORM_VALUES
  })

  const jobType = useWatch({ control, name: 'type' })
  const onlineOnly = useWatch({ control, name: 'online_only' })
  const isMulti = useWatch({ control, name: 'is_multi' })
  const sqlQueries = useWatch({ control, name: 'sql_query' }) ?? []
  const scheduleEnabled = useWatch({ control, name: 'schedule_enabled' })
  const scheduleType = useWatch({ control, name: 'schedule_type' })
  const scheduleDays = useWatch({ control, name: 'schedule_days' }) ?? []
  const scheduleIntervalUnit = useWatch({ control, name: 'schedule_interval_unit' }) ?? 'minutes'
  const destType = useWatch({ control, name: 'destination_type' })
  const selectedJobGroupId = useWatch({ control, name: 'job_group_id' })
  const selectedConnectionIds = useWatch({ control, name: 'connection_ids' }) ?? []
  const sheetIdInput = useWatch({ control, name: 'sheet_id' })
  const currentSheetName = useWatch({ control, name: 'sheet_name' })
  const apiMethod = useWatch({ control, name: 'api_method' })
  const excelPath = useWatch({ control, name: 'excel_path' })
  const operation = useWatch({ control, name: 'operation' })
  const actionTargetTable = useWatch({ control, name: 'action_target_table' })
  const actionMode = useWatch({ control, name: 'action_mode' })
  const actionKeyColumns = useWatch({ control, name: 'action_key_columns' })
  const actionBatchSize = useWatch({ control, name: 'action_batch_size' })
  const actionColumnMapping = useWatch({ control, name: 'action_column_mapping' })
  // Connection filters
  const [filterGroup, setFilterGroup] = useState<number | null>(null)
  const [filterStore, setFilterStore] = useState<number | null>(null)
  const [filterFiscalYear, setFilterFiscalYear] = useState<number | null>(null)
  const [actionUpload, setActionUpload] = useState<ActionStagedUpload | null>(null)
  const [actionPreview, setActionPreview] = useState<ActionFilePreview | null>(null)
  const [actionPreviewLoading, setActionPreviewLoading] = useState(false)
  const [actionPreviewError, setActionPreviewError] = useState<string | null>(null)
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false)

  useEffect(() => {
    if (isOpen) {
      if (mode === 'create') {
        const draft = createDraft.readDraft()
        reset(draft ? { ...DEFAULT_FORM_VALUES, ...normalizeJobDraft(draft) } : DEFAULT_FORM_VALUES)
        return
      }

      // Parse destination_config back into sub-fields when editing
      let api_endpoint = '',
        api_method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'POST',
        api_headers = ''
      let sheet_id = '',
        sheet_name = 'Sheet1',
        sheet_credentials = ''
      let excel_path = ''
      let action_file_path = ''
      let action_file_name = ''
      let action_sheet_name = ''
      let action_target_table = ''
      let action_mode: 'insert' | 'update' | 'upsert' = 'upsert'
      let action_key_columns = 'id'
      let action_batch_size = 1000
      let action_column_mapping = ''
      if (data?.destination_type && data?.destination_config) {
        try {
          if (data.destination_type === 'api') {
            const p = JSON.parse(data.destination_config)
            api_endpoint = p.endpoint ?? ''
            api_method = p.method ?? 'POST'
            api_headers = p.headers ?? ''
          } else if (data.destination_type === 'google_sheets') {
            const p = JSON.parse(data.destination_config)
            sheet_id = p.spreadsheetId ?? ''
            sheet_name = p.sheetName ?? 'Sheet1'
            sheet_credentials = p.credentials ?? ''
          } else if (data.destination_type === 'excel') {
            excel_path = data.destination_config
          }
        } catch (err) {
          console.error('Failed to parse destination_config:', err)
        }
      }

      if (data?.type === 'action' && data?.destination_config) {
        try {
          const p = JSON.parse(data.destination_config)
          action_file_path = p.filePath ?? p.stagedPath ?? ''
          action_file_name = p.fileName ?? ''
          action_sheet_name = p.sheetName ?? ''
          action_target_table = p.table ?? p.targetTable ?? ''
          action_mode = (p.mode as 'insert' | 'update' | 'upsert') ?? 'upsert'
          action_key_columns = Array.isArray(p.keyColumns) ? p.keyColumns.join(', ') : 'id'
          action_batch_size = Number.isFinite(Number(p.batchSize)) ? Number(p.batchSize) : 1000
          action_column_mapping =
            p.columnMapping && typeof p.columnMapping === 'object'
              ? JSON.stringify(p.columnMapping)
              : ''
        } catch (err) {
          console.error('Failed to parse action destination_config:', err)
        }
      }
      reset({
        name: data?.name ?? '',
        description: data?.description ?? '',
        job_group_id: data?.job_group_id ?? null,
        type: data?.type ?? 'query',
        online_only: data?.online_only ?? false,
        is_multi: data?.is_multi ?? false,
        connection_ids: data?.connection_ids ?? [],
        sql_query: data?.sql_query?.length ? data.sql_query : [''],
        sql_query_names: data?.sql_query?.length
          ? (data.sql_query_names?.slice(0, data.sql_query.length) ?? []).concat(
              Array(Math.max(0, data.sql_query.length - (data.sql_query_names?.length ?? 0))).fill(
                ''
              )
            )
          : [],
        destination_type: data?.destination_type ?? null,
        destination_config: data?.destination_config ?? null,
        operation: data?.operation ?? null,
        notify_webhook: data?.notify_webhook ?? '',
        api_endpoint,
        api_method,
        api_headers,
        sheet_id,
        sheet_name,
        sheet_credentials,
        excel_path,
        template_path: data?.template_path ?? null,
        template_mode: data?.template_mode ?? null,
        action_file_path,
        action_file_name,
        action_sheet_name,
        action_target_table,
        action_mode,
        action_key_columns,
        action_batch_size,
        action_column_mapping,
        // Parse schedule JSON back into sub-fields
        ...parseSchedule(data?.schedule_raw)
      })
    }
  }, [isOpen, mode, data, reset, createDraft])

  const selectedConnections = connections.filter((c) => selectedConnectionIds.includes(c.id))
  const defaultSingleSheetName =
    toGoogleSheetTabName(selectedConnections[0]?.name ?? '') || 'Sheet1'

  useEffect(() => {
    if (destType !== 'google_sheets') return

    if (isMulti) {
      if (currentSheetName) {
        setValue('sheet_name', '')
      }
      return
    }

    if (!currentSheetName || currentSheetName === 'Sheet1') {
      setValue('sheet_name', defaultSingleSheetName)
    }
  }, [destType, isMulti, currentSheetName, defaultSingleSheetName, setValue])

  useEffect(() => {
    if (destType !== 'google_sheets') return

    const raw = (sheetIdInput ?? '').trim()
    if (!raw) return

    const extractedId = getSpreadsheetId(raw)
    if (extractedId && extractedId !== raw) {
      setValue('sheet_id', extractedId, { shouldValidate: true })
    }
  }, [destType, sheetIdInput, setValue])

  useEffect(() => {
    const wasOpen = wasOpenRef.current

    if (mode === 'create' && wasOpen && !isOpen && !skipAutoSaveOnCloseRef.current) {
      createDraft.saveDraft(normalizeJobDraft(getValues()))
    }

    if (!isOpen && skipAutoSaveOnCloseRef.current) {
      skipAutoSaveOnCloseRef.current = false
    }

    wasOpenRef.current = isOpen
  }, [isOpen, mode, createDraft, getValues])

  useEffect(() => {
    return () => {
      if (mode === 'create' && isOpen && !skipAutoSaveOnCloseRef.current) {
        createDraft.saveDraft(normalizeJobDraft(getValues()))
      }

      if (actionUpload?.stagedPath && !preserveStagedOnCloseRef.current) {
        void window.api.jobs.cleanupStaged(actionUpload.stagedPath)
      }
    }
  }, [mode, isOpen, createDraft, getValues, actionUpload])

  useEffect(() => {
    if (isOpen) return
    if (actionUpload?.stagedPath && !preserveStagedOnCloseRef.current) {
      void window.api.jobs.cleanupStaged(actionUpload.stagedPath)
    }
    preserveStagedOnCloseRef.current = false
    setActionUpload(null)
    setActionPreview(null)
    setActionPreviewError(null)
  }, [isOpen, actionUpload])

  async function loadActionPreview(stagedPath: string, sheetName?: string): Promise<void> {
    setActionPreviewLoading(true)
    setActionPreviewError(null)
    try {
      const preview = await window.api.jobs.previewStagedFile(stagedPath, sheetName, 20)
      setActionPreview(preview)
      setValue('action_sheet_name', preview.activeSheet ?? sheetName ?? '')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to preview action file'
      setActionPreviewError(message)
      setActionPreview(null)
    } finally {
      setActionPreviewLoading(false)
    }
  }

  async function pickActionFile(): Promise<void> {
    const selectedPath = await window.api.dialog.openFile({
      title: 'Select Action Input File',
      filters: [{ name: 'Data Files', extensions: ['csv', 'xlsx', 'xls'] }]
    })
    if (!selectedPath) return

    setActionPreviewLoading(true)
    setActionPreviewError(null)
    try {
      const staged = await window.api.jobs.stageUpload(null, selectedPath)

      if (actionUpload?.stagedPath) {
        void window.api.jobs.cleanupStaged(actionUpload.stagedPath)
      }

      setActionUpload(staged)
      setValue('action_file_path', staged.stagedPath)
      setValue('action_file_name', staged.filename)
      setValue('action_column_mapping', '')
      const preview = await window.api.jobs.previewStagedFile(staged.stagedPath, undefined, 20)
      setActionPreview(preview)
      setValue('action_sheet_name', preview.activeSheet ?? '')

      if (!getValues('action_key_columns')) {
        const firstKey = preview.headers.includes('id')
          ? 'id'
          : preview.headers[0]
            ? String(preview.headers[0])
            : ''
        setValue('action_key_columns', firstKey)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stage file for action job'
      setActionPreviewError(message)
      setActionUpload(null)
      setActionPreview(null)
    } finally {
      setActionPreviewLoading(false)
    }
  }

  function onValid(values: JobFormValues): void {
    // Serialize destination sub-fields into destination_config as JSON
    let destination_config: string | null | undefined = values.destination_config
    if (values.destination_type === 'api') {
      destination_config = JSON.stringify({
        endpoint: values.api_endpoint ?? '',
        method: values.api_method ?? 'POST',
        headers: values.api_headers ?? ''
      })
    } else if (values.destination_type === 'google_sheets') {
      const rawSheetIdOrUrl = (values.sheet_id ?? '').trim()
      const sheetId = getSpreadsheetId(rawSheetIdOrUrl) ?? rawSheetIdOrUrl
      const sheetName = values.is_multi
        ? ''
        : (values.sheet_name ?? '').trim() || defaultSingleSheetName

      destination_config = JSON.stringify({
        // Optional: if empty, runtime can auto-create a spreadsheet.
        spreadsheetId: sheetId || null,
        // Single query uses one tab; multi-query/runtime can create dynamic tabs per connection/query.
        sheetName,
        sheetNameMode: values.is_multi ? 'dynamic_connection_name' : 'single_tab',
        credentials: values.sheet_credentials ?? ''
      })
    } else if (values.destination_type === 'excel') {
      destination_config = values.excel_path ?? null
    }

    // Auto-derive template from the Excel destination path:
    //   - destination ends in .xlsx → treat it AS the template (existing mode),
    //     combiner rewrites INTO this file rather than creating a new one.
    //   - destination is a folder → no template; new .xlsx created per run.
    let derivedTemplatePath: string | null = null
    let derivedTemplateMode: 'new' | 'existing' | null = null
    if (values.destination_type === 'excel') {
      const p = (values.excel_path ?? '').trim()
      if (p.toLowerCase().endsWith('.xlsx')) {
        derivedTemplatePath = p
        derivedTemplateMode = 'existing'
      }
    }

    if (values.type === 'action') {
      const stagedPath = (values.action_file_path ?? '').trim()
      if (stagedPath) {
        preserveStagedOnCloseRef.current = true
      }
      const keyColumns = (values.action_key_columns ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)

      const mappingHeaders = actionPreview?.headers ?? []
      const identityMapping = Object.fromEntries(mappingHeaders.map((h) => [h, h]))
      let columnMapping: Record<string, string> = identityMapping
      const rawMapping = (values.action_column_mapping ?? '').trim()
      if (rawMapping) {
        try {
          const parsed = JSON.parse(rawMapping)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Keep only non-empty string targets
            columnMapping = Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'string' && (v as string).trim().length > 0)
                .map(([k, v]) => [k, String(v).trim()])
            )
          }
        } catch (err) {
          console.error('Invalid action_column_mapping JSON:', err)
        }
      }

      destination_config = JSON.stringify({
        filePath: stagedPath,
        fileName: (values.action_file_name ?? '').trim() || null,
        sheetName: (values.action_sheet_name ?? '').trim() || null,
        table: (values.action_target_table ?? '').trim(),
        mode: values.action_mode ?? 'upsert',
        keyColumns,
        batchSize: values.action_batch_size ?? 1000,
        columnMapping
      })
    }
    // Serialize schedule
    let schedule: string | null = null
    if (values.schedule_enabled && values.schedule_type) {
      schedule = JSON.stringify({
        type: values.schedule_type,
        time: values.schedule_time,
        days: values.schedule_days,
        date: values.schedule_date,
        intervalValue: values.schedule_interval_value,
        intervalUnit: values.schedule_interval_unit,
        cron: values.schedule_cron,
        repeatCount: values.schedule_repeat_count
      })
    }
    onSubmit({
      ...values,
      destination_config,
      schedule,
      template_path: derivedTemplatePath,
      template_mode: derivedTemplateMode
    } as JobFormValues)
    if (mode === 'create') {
      skipAutoSaveOnCloseRef.current = true
      createDraft.clearDraft()
    }
    reset(DEFAULT_FORM_VALUES)
    onOpenChange(false)
  }

  function removeDraftAndClose(): void {
    skipAutoSaveOnCloseRef.current = true
    preserveStagedOnCloseRef.current = false
    createDraft.clearDraft()
    reset(DEFAULT_FORM_VALUES)
    onOpenChange(false)
  }

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void handleSubmit(onValid)(event)
  }

  const filteredConnections = connections.filter((c) => {
    if (filterGroup !== null && c.group_id !== filterGroup) return false
    if (filterStore !== null && c.store_id !== filterStore) return false
    if (filterFiscalYear !== null && c.fiscal_year_id !== filterFiscalYear) return false
    return true
  })

  const connectionOptions = filteredConnections.map((c) => ({
    value: c.id,
    label: c.name,
    data: c
  }))

  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }))
  const jobGroupOptions = jobGroups.map((g) => ({ value: g.id, label: g.name }))
  const storeOptions = stores.map((s) => ({ value: s.id, label: s.name }))
  const fiscalYearOptions = fiscalYears.map((fy) => ({ value: fy.id, label: fy.name }))

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden w-full sm:min-w-2xl flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle>{mode === 'create' ? 'New Job' : 'Edit Job'}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? 'Configure a new data sync job.' : 'Update job configuration.'}
          </DialogDescription>
        </DialogHeader>
        <Separator className="mt-0" />

        <form onSubmit={handleFormSubmit} className="flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1 overflow-auto">
            <div className="flex flex-col gap-0 px-6 py-4">
              {/* ── Step 1: Basic Info ─────────────────────────────────────────── */}
              <FormSection
                step={1}
                title="Basic Info"
                description="Name and description for this job"
              >
                <FieldGroup>
                  <Field data-invalid={!!errors.name}>
                    <FieldLabel htmlFor="name">
                      Job Name <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input id="name" placeholder="e.g. Daily Sales Sync" {...register('name')} />
                    <FieldError errors={[errors.name]} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="description">Description</FieldLabel>
                    <Input
                      id="description"
                      placeholder="What does this job do?"
                      {...register('description')}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Job Group</FieldLabel>
                    <SelectBox
                      options={jobGroupOptions}
                      value={selectedJobGroupId ?? undefined}
                      onChange={(v) =>
                        setValue('job_group_id', normalizeNumber(v), { shouldValidate: true })
                      }
                      placeholder="Select job group…"
                      clearable
                      searchable
                    />
                  </Field>
                </FieldGroup>
              </FormSection>

              {/* ── Step 2: Job Type ───────────────────────────────────────────── */}
              <FormSection
                step={2}
                title="Job Type"
                description="Query fetches & exports data — Action modifies data directly"
              >
                <div className="grid grid-cols-2 gap-2">
                  {(['query', 'action'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setValue('type', t)}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg border p-3 text-left transition-all',
                        jobType === t
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-muted-foreground/40'
                      )}
                    >
                      <span className="text-sm font-medium capitalize">{t}</span>
                      <span className="text-xs text-muted-foreground">
                        {t === 'query'
                          ? 'SELECT data and push to a destination'
                          : 'INSERT / UPDATE / DELETE — no destination needed'}
                      </span>
                    </button>
                  ))}
                </div>
              </FormSection>

              {/* ── Step 3: Connections ────────────────────────────────────────── */}
              <FormSection
                step={3}
                title="Connections"
                description="Filter by group / store / fiscal year, then select connections"
              >
                <div className="flex flex-col gap-2">
                  {/* Filters row */}
                  <div className="grid grid-cols-3 gap-2">
                    <SelectBox
                      options={groupOptions}
                      value={filterGroup ?? undefined}
                      onChange={(v) => {
                        setFilterGroup(normalizeNumber(v))
                        setValue('connection_ids', [])
                      }}
                      placeholder="Group…"
                      clearable
                      searchable
                    />
                    <SelectBox
                      options={storeOptions}
                      value={filterStore ?? undefined}
                      onChange={(v) => {
                        setFilterStore(normalizeNumber(v))
                        setValue('connection_ids', [])
                      }}
                      placeholder="Store…"
                      clearable
                      searchable
                    />
                    <SelectBox
                      options={fiscalYearOptions}
                      value={filterFiscalYear ?? undefined}
                      onChange={(v) => {
                        setFilterFiscalYear(normalizeNumber(v))
                        setValue('connection_ids', [])
                      }}
                      placeholder="Fiscal Year…"
                      clearable
                      searchable
                    />
                  </div>

                  {/* Connection selector */}
                  <Field data-invalid={!!errors.connection_ids}>
                    {isMulti ? (
                      <SelectBox
                        options={connectionOptions}
                        value={selectedConnectionIds[0] ?? undefined}
                        onChange={(val) => {
                          const ids = val != null ? normalizeNumberArray([val]) : []
                          setValue('connection_ids', ids.slice(0, 1), { shouldValidate: true })
                        }}
                        placeholder={
                          filteredConnections.length === 0
                            ? 'No connections match the current filters'
                            : `Select from ${filteredConnections.length} connection(s)…`
                        }
                        searchable
                        clearable
                      />
                    ) : (
                      <SelectBox
                        multiple
                        options={connectionOptions}
                        value={selectedConnectionIds}
                        onChange={(vals) => {
                          const ids = Array.isArray(vals)
                            ? normalizeNumberArray(vals)
                            : vals != null
                              ? normalizeNumberArray([vals])
                              : []
                          setValue('connection_ids', ids, { shouldValidate: true })
                        }}
                        placeholder={
                          filteredConnections.length === 0
                            ? 'No connections match the current filters'
                            : `Select from ${filteredConnections.length} connection(s)…`
                        }
                        searchable
                        clearable
                        showSelectAll
                      />
                    )}
                    {errors.connection_ids && (
                      <p className="text-xs text-destructive mt-1">
                        {errors.connection_ids.message}
                      </p>
                    )}
                  </Field>

                  <div className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2">
                    <div>
                      <p className="text-xs font-medium">Online connections only</p>
                      <p className="text-xs text-muted-foreground">
                        Run this job only for connections that are currently online
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={onlineOnly}
                      onClick={() => setValue('online_only', !onlineOnly)}
                      className={cn(
                        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
                        'transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        onlineOnly ? 'bg-primary' : 'bg-input'
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none block size-4 rounded-full bg-background shadow ring-0 transition-transform duration-200',
                          onlineOnly ? 'translate-x-4' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>

                  {/* is_multi toggle — available for both query and action types */}
                  <div className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2">
                    <div>
                      <p className="text-xs font-medium">Multi-Query mode</p>
                      <p className="text-xs text-muted-foreground">Run multiple SQL queries</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isMulti}
                      onClick={() => {
                        const next = !isMulti
                        setValue('is_multi', next)
                        setValue('sql_query', [''])
                        setValue('sql_query_names', next ? [''] : [])
                        // Multi-query requires a single connection so every query
                        // produces its own bucket. Trim to the first selection.
                        if (next && selectedConnectionIds.length > 1) {
                          setValue('connection_ids', selectedConnectionIds.slice(0, 1))
                        }
                      }}
                      className={cn(
                        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
                        'transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isMulti ? 'bg-primary' : 'bg-input'
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none block size-4 rounded-full bg-background shadow ring-0 transition-transform duration-200',
                          isMulti ? 'translate-x-4' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>
                </div>
              </FormSection>

              {/* ── Step 4: SQL Queries (both query and action types) ──────── */}
              <FormSection
                step={4}
                title="SQL Queries"
                description={
                  isMulti
                    ? 'Multiple queries — all run on every selected connection'
                    : 'Single query runs on all selected connections'
                }
              >
                <div className="flex flex-col gap-2">
                  {isMulti ? (
                    /* Multi mode — manual add/remove queries (same for query and action) */
                    <>
                      {sqlQueries.map((_, i) => (
                        <div key={i} className="flex flex-col gap-2 p-3 rounded-lg border">
                          <div className="flex items-center justify-between gap-2">
                            <Input
                              placeholder={`Query name (e.g., Sales Data, Inventory)`}
                              className="flex-1 text-xs h-8"
                              {...register(`sql_query_names.${i}` as `sql_query_names.${number}`)}
                            />
                            {sqlQueries.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const queries = getValues('sql_query')
                                  const names = getValues('sql_query_names') ?? []
                                  setValue(
                                    'sql_query',
                                    queries.filter((_, idx) => idx !== i)
                                  )
                                  setValue(
                                    'sql_query_names',
                                    names.filter((_, idx) => idx !== i)
                                  )
                                }}
                                className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </div>
                          <Textarea
                            placeholder={
                              jobType === 'action'
                                ? "INSERT INTO logs (event) VALUES ('job_run')"
                                : 'SELECT * FROM sales WHERE date = GETDATE()'
                            }
                            rows={3}
                            className="font-mono text-xs resize-none"
                            {...register(`sql_query.${i}` as `sql_query.${number}`)}
                          />
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full mt-1"
                        onClick={() => {
                          setValue('sql_query', [...sqlQueries, ''])
                          const names = getValues('sql_query_names') || []
                          setValue('sql_query_names', [...names, ''])
                        }}
                      >
                        <Plus className="size-3.5 mr-1" />
                        Add Query
                      </Button>
                    </>
                  ) : (
                    /* Single query — shared across all connections */
                    <Textarea
                      placeholder={
                        jobType === 'action'
                          ? "INSERT INTO logs (event) VALUES ('job_run')"
                          : 'SELECT * FROM sales WHERE date = GETDATE()'
                      }
                      rows={4}
                      className="font-mono text-xs resize-none"
                      {...register('sql_query.0')}
                    />
                  )}
                </div>
              </FormSection>

              {/* ── Step 5: Destination (query type only — action modifies DB directly) */}
              {jobType === 'query' && (
                <FormSection
                  step={isMulti ? 5 : 5}
                  title="Destination"
                  description="Where should the query results be sent?"
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Destination Type</FieldLabel>
                      <SelectBox
                        options={[
                          { value: 'api', label: 'API Endpoint' },
                          { value: 'google_sheets', label: 'Google Sheets' },
                          { value: 'excel', label: 'Excel' }
                        ]}
                        value={destType ?? undefined}
                        onChange={(v) =>
                          setValue(
                            'destination_type',
                            (v as 'api' | 'google_sheets' | 'excel') ?? null
                          )
                        }
                        placeholder="Choose destination…"
                        clearable
                      />
                    </Field>

                    {/* API */}
                    {destType === 'api' && (
                      <>
                        <Field>
                          <FieldLabel htmlFor="api_endpoint">
                            Endpoint URL <span className="text-destructive">*</span>
                          </FieldLabel>
                          <Input
                            id="api_endpoint"
                            placeholder="https://api.example.com/data"
                            {...register('api_endpoint')}
                          />
                        </Field>
                        <Field>
                          <FieldLabel>HTTP Method</FieldLabel>
                          <SelectBox
                            options={[
                              { value: 'POST', label: 'POST' },
                              { value: 'PUT', label: 'PUT' },
                              { value: 'PATCH', label: 'PATCH' },
                              { value: 'GET', label: 'GET' }
                            ]}
                            value={apiMethod ?? 'POST'}
                            onChange={(v) =>
                              setValue(
                                'api_method',
                                (v as 'GET' | 'POST' | 'PUT' | 'PATCH') ?? 'POST'
                              )
                            }
                            placeholder="Select method…"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="api_headers">Request Headers</FieldLabel>
                          <Textarea
                            id="api_headers"
                            placeholder={
                              '{{\n  "Authorization": "Bearer your-token",\n  "Content-Type": "application/json"\n}}'
                            }
                            rows={4}
                            className="font-mono text-xs resize-none"
                            {...register('api_headers')}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Paste a JSON object with key-value header pairs
                          </p>
                        </Field>
                      </>
                    )}

                    {/* Google Sheets */}
                    {destType === 'google_sheets' && (
                      <>
                        <Field>
                          <FieldLabel htmlFor="sheet_id">Spreadsheet URL (Optional)</FieldLabel>
                          <Input
                            id="sheet_id"
                            placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit"
                            className="font-mono text-xs"
                            {...register('sheet_id')}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Leave empty to auto-create a new spreadsheet at runtime. If provided,
                            paste URL or direct ID, we auto-convert internally to spreadsheet ID.
                          </p>
                        </Field>

                        {!isMulti && (
                          <Field>
                            <FieldLabel htmlFor="sheet_name">Sheet / Tab Name</FieldLabel>
                            <Input
                              id="sheet_name"
                              placeholder={defaultSingleSheetName}
                              {...register('sheet_name')}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Default tab name is based on the selected connection name.
                            </p>
                          </Field>
                        )}

                        {isMulti && (
                          <p className="text-xs text-muted-foreground">
                            Multi-query mode will create/use dynamic tab names per connection.
                          </p>
                        )}

                        <Field>
                          <FieldLabel htmlFor="sheet_credentials">
                            Service Account Credentials
                          </FieldLabel>
                          <Textarea
                            id="sheet_credentials"
                            placeholder={
                              '{{\n  "type": "service_account",\n  "project_id": "your-project",\n  "private_key_id": "...",\n  "private_key": "-----BEGIN RSA PRIVATE KEY-----\\n..."\n}}'
                            }
                            rows={6}
                            className="font-mono text-xs resize-none"
                            {...register('sheet_credentials')}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Paste the full contents of your Google service account JSON key file
                          </p>
                        </Field>
                      </>
                    )}

                    {/* Excel — native file/folder picker */}
                    {destType === 'excel' && (
                      <Field>
                        <FieldLabel>Output Path</FieldLabel>
                        <div className="flex gap-2">
                          <Input
                            placeholder="/Reports/daily_sales.xlsx or /Reports/"
                            className="font-mono text-xs"
                            value={excelPath ?? ''}
                            onChange={(e) => setValue('excel_path', e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title="Select existing file (append / replace)"
                            onClick={async () => {
                              const path = await window.api.dialog.openFile({
                                title: 'Select Excel File',
                                filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }]
                              })
                              if (path) setValue('excel_path', path)
                            }}
                          >
                            <FileText className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title="Select folder — creates new file each run"
                            onClick={async () => {
                              const folder = await window.api.dialog.openFolder({
                                title: 'Select Output Folder'
                              })
                              if (folder) setValue('excel_path', folder)
                            }}
                          >
                            <FolderOpen className="size-4" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          <strong>File:</strong> Update that file (append/replace).{' '}
                          <strong>Folder:</strong> New file each run named{' '}
                          <code>{'{job}_{timestamp}.xlsx'}</code>
                        </p>
                      </Field>
                    )}

                    {/* Write mode — only for file-based excel or google sheets with URL */}
                    {destType === 'excel' && excelPath && /\.(xlsx|xls|csv)$/i.test(excelPath) && (
                      <Field>
                        <FieldLabel>Write Mode</FieldLabel>
                        <SelectBox
                          options={[
                            { value: 'append', label: 'Append — add rows to existing data' },
                            { value: 'replace', label: 'Replace — overwrite all existing data' }
                          ]}
                          value={operation ?? undefined}
                          onChange={(v) =>
                            setValue('operation', (v as 'append' | 'replace') ?? null)
                          }
                          placeholder="Choose write mode…"
                          clearable
                        />
                      </Field>
                    )}

                    {/*
                      Excel template field removed: the Destination Path IS the
                      template when it points to an existing .xlsx. The combiner
                      will rewrite INTO that file instead of creating a new one.
                    */}

                    {destType === 'google_sheets' && sheetIdInput && (
                      <Field>
                        <FieldLabel>Write Mode</FieldLabel>
                        <SelectBox
                          options={[
                            { value: 'append', label: 'Append — add rows to existing data' },
                            { value: 'replace', label: 'Replace — overwrite all existing data' }
                          ]}
                          value={operation ?? undefined}
                          onChange={(v) =>
                            setValue('operation', (v as 'append' | 'replace') ?? null)
                          }
                          placeholder="Choose write mode…"
                          clearable
                        />
                      </Field>
                    )}
                  </FieldGroup>
                </FormSection>
              )}

              {/* ── Step 5: Action File (action type only) ────────────────────── */}
              {jobType === 'action' && (
                <FormSection
                  step={5}
                  title="Action File"
                  description="Pick CSV/Excel and preview columns before mapping"
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void pickActionFile()}
                        disabled={actionPreviewLoading}
                      >
                        <FileText className="size-4 mr-2" />
                        {actionUpload ? 'Change File' : 'Choose CSV / Excel'}
                      </Button>
                      {actionPreview && actionPreview.headers.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setMappingDialogOpen(true)}
                        >
                          Map Columns
                          {(() => {
                            const count = countMappedTargets(
                              actionColumnMapping,
                              actionPreview.headers
                            )
                            return (
                              <Badge
                                variant={count > 0 ? 'default' : 'secondary'}
                                className="ml-2 text-[10px]"
                              >
                                {count > 0
                                  ? `${count}/${actionPreview.headers.length}`
                                  : 'identity'}
                              </Badge>
                            )
                          })()}
                        </Button>
                      )}
                      {actionPreviewLoading && <Badge variant="secondary">Loading preview…</Badge>}
                      {actionUpload && (
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {actionUpload.filename}
                        </Badge>
                      )}
                    </div>

                    {actionPreviewError && (
                      <p className="text-xs text-destructive">{actionPreviewError}</p>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <Field>
                        <FieldLabel htmlFor="action_target_table">
                          Target Table <span className="text-destructive">*</span>
                        </FieldLabel>
                        <Input
                          id="action_target_table"
                          placeholder="dbo.products"
                          className="font-mono text-xs"
                          value={actionTargetTable ?? ''}
                          onChange={(e) => setValue('action_target_table', e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Operation</FieldLabel>
                        <SelectBox
                          options={[
                            { value: 'insert', label: 'INSERT' },
                            { value: 'update', label: 'UPDATE' },
                            { value: 'upsert', label: 'UPSERT (MERGE)' }
                          ]}
                          value={actionMode ?? 'upsert'}
                          onChange={(v) =>
                            setValue(
                              'action_mode',
                              (v as 'insert' | 'update' | 'upsert') ?? 'upsert'
                            )
                          }
                          placeholder="Choose operation…"
                        />
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Field>
                        <FieldLabel htmlFor="action_key_columns">Key Columns</FieldLabel>
                        <Input
                          id="action_key_columns"
                          placeholder="id, store_id"
                          className="font-mono text-xs"
                          value={actionKeyColumns ?? ''}
                          onChange={(e) => setValue('action_key_columns', e.target.value)}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          For UPDATE/UPSERT. Comma separated DB columns.
                        </p>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="action_batch_size">Batch Size</FieldLabel>
                        <Input
                          id="action_batch_size"
                          type="number"
                          min={100}
                          max={2000}
                          value={actionBatchSize ?? 1000}
                          onChange={(e) =>
                            setValue('action_batch_size', Number(e.target.value || 1000))
                          }
                        />
                      </Field>
                    </div>

                    {actionUpload && actionPreview && (
                      <>
                        {(actionPreview.sheetNames?.length ?? 0) > 1 && (
                          <Field>
                            <FieldLabel>Worksheet</FieldLabel>
                            <SelectBox
                              options={(actionPreview.sheetNames ?? []).map((name) => ({
                                value: name,
                                label: name
                              }))}
                              value={actionPreview.activeSheet}
                              onChange={(value) => {
                                const selectedSheet = value ? String(value) : undefined
                                void loadActionPreview(actionUpload.stagedPath, selectedSheet)
                              }}
                              placeholder="Choose worksheet…"
                            />
                          </Field>
                        )}

                        <div className="rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">
                            Detected {actionPreview.headers.length} column(s), sampled{' '}
                            {actionPreview.totalSampledRows} row(s)
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {actionPreview.headers.map((header) => (
                              <Badge key={header} variant="outline" className="text-[11px]">
                                {header}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {actionPreview.sampleRows.length > 0 && (
                          <div className="max-h-52 overflow-auto rounded-lg border">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/50 sticky top-0 z-10">
                                <tr>
                                  {actionPreview.headers.map((header) => (
                                    <th
                                      key={header}
                                      className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium"
                                    >
                                      {header}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {actionPreview.sampleRows.map((row, rowIndex) => (
                                  <tr key={rowIndex} className="odd:bg-background even:bg-muted/20">
                                    {actionPreview.headers.map((header) => (
                                      <td key={`${rowIndex}-${header}`} className="px-2 py-1.5">
                                        {String(row[header] ?? '')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </FormSection>
              )}

              {/* ── Step 6: Webhook (action type only) ────────────────────────── */}
              {jobType === 'action' && (
                <FormSection
                  step={6}
                  title="Webhook"
                  description="Optional — notify a URL when this action runs"
                >
                  <Field data-invalid={!!errors.notify_webhook}>
                    <FieldLabel htmlFor="notify_webhook">Webhook URL</FieldLabel>
                    <Input
                      id="notify_webhook"
                      placeholder="https://hooks.slack.com/services/..."
                      {...register('notify_webhook')}
                    />
                    <FieldError errors={[errors.notify_webhook]} />
                  </Field>
                </FormSection>
              )}

              {/* ── Step 6: Schedule ───────────────────────────────────────────── */}
              <FormSection
                step={jobType === 'action' ? 7 : 6}
                title="Schedule"
                description="Configure when this job should run automatically"
              >
                <div className="flex flex-col gap-3">
                  {/* Enable toggle */}
                  <div className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2">
                    <div>
                      <p className="text-xs font-medium">Enable Schedule</p>
                      <p className="text-xs text-muted-foreground">
                        Run this job automatically on a schedule
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={scheduleEnabled}
                      onClick={() => setValue('schedule_enabled', !scheduleEnabled)}
                      className={cn(
                        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
                        'transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        scheduleEnabled ? 'bg-primary' : 'bg-input'
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none block size-4 rounded-full bg-background shadow ring-0 transition-transform duration-200',
                          scheduleEnabled ? 'translate-x-4' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>

                  {scheduleEnabled && (
                    <div className="flex flex-col gap-3 rounded-lg border p-3">
                      {/* Schedule type */}
                      <Field>
                        <FieldLabel>Schedule Type</FieldLabel>
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              { value: 'once', label: 'Run Once' },
                              { value: 'daily', label: 'Daily' },
                              { value: 'weekly', label: 'Weekly' },
                              { value: 'monthly', label: 'Monthly' },
                              { value: 'interval', label: 'Interval' },
                              { value: 'cron', label: 'Cron' }
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setValue('schedule_type', opt.value)}
                              className={cn(
                                'rounded-md border px-2 py-1.5 text-xs text-left transition-all',
                                scheduleType === opt.value
                                  ? 'border-primary bg-primary/5 ring-1 ring-primary font-medium'
                                  : 'border-border hover:border-muted-foreground/40'
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </Field>

                      {/* Once — date + time */}
                      {scheduleType === 'once' && (
                        <div className="grid grid-cols-2 gap-2">
                          <Field>
                            <FieldLabel>Date</FieldLabel>
                            <Input type="date" {...register('schedule_date')} />
                          </Field>
                          <Field>
                            <FieldLabel>Time</FieldLabel>
                            <Input type="time" {...register('schedule_time')} />
                          </Field>
                        </div>
                      )}

                      {/* Daily — time */}
                      {scheduleType === 'daily' && (
                        <Field>
                          <FieldLabel>Run at time</FieldLabel>
                          <Input type="time" className="w-36" {...register('schedule_time')} />
                        </Field>
                      )}

                      {/* Weekly — days + time */}
                      {scheduleType === 'weekly' && (
                        <div className="flex flex-col gap-2">
                          <Field>
                            <FieldLabel>Days of week</FieldLabel>
                            <div className="flex flex-wrap gap-1.5">
                              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => {
                                const selected = scheduleDays.includes(idx)
                                return (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => {
                                      const current = scheduleDays
                                      setValue(
                                        'schedule_days',
                                        selected
                                          ? current.filter((d) => d !== idx)
                                          : [...current, idx]
                                      )
                                    }}
                                    className={cn(
                                      'rounded-md border px-2 py-1 text-xs transition-all',
                                      selected
                                        ? 'border-primary bg-primary/5 ring-1 ring-primary font-medium'
                                        : 'border-border hover:border-muted-foreground/40'
                                    )}
                                  >
                                    {day}
                                  </button>
                                )
                              })}
                            </div>
                          </Field>
                          <Field>
                            <FieldLabel>Run at time</FieldLabel>
                            <Input type="time" className="w-36" {...register('schedule_time')} />
                          </Field>
                        </div>
                      )}

                      {/* Monthly — date of month + time */}
                      {scheduleType === 'monthly' && (
                        <div className="grid grid-cols-2 gap-2">
                          <Field>
                            <FieldLabel>Day of month</FieldLabel>
                            <Input
                              type="number"
                              min={1}
                              max={31}
                              placeholder="1"
                              {...register('schedule_date')}
                            />
                          </Field>
                          <Field>
                            <FieldLabel>Run at time</FieldLabel>
                            <Input type="time" {...register('schedule_time')} />
                          </Field>
                        </div>
                      )}

                      {/* Interval — value + unit */}
                      {scheduleType === 'interval' && (
                        <div className="grid grid-cols-2 gap-2">
                          <Field>
                            <FieldLabel>Every</FieldLabel>
                            <Input
                              type="number"
                              min={1}
                              placeholder="30"
                              {...register('schedule_interval_value', { valueAsNumber: true })}
                            />
                          </Field>
                          <Field>
                            <FieldLabel>Unit</FieldLabel>
                            <SelectBox
                              options={[
                                { value: 'minutes', label: 'Minutes' },
                                { value: 'hours', label: 'Hours' }
                              ]}
                              value={scheduleIntervalUnit}
                              onChange={(v) =>
                                setValue(
                                  'schedule_interval_unit',
                                  (v as 'minutes' | 'hours') ?? 'minutes'
                                )
                              }
                              placeholder="Unit…"
                            />
                          </Field>
                        </div>
                      )}

                      {/* Cron expression */}
                      {scheduleType === 'cron' && (
                        <Field>
                          <FieldLabel>Cron Expression</FieldLabel>
                          <Input
                            placeholder="0 8 * * *"
                            className="font-mono text-xs"
                            {...register('schedule_cron')}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Standard cron format: minute hour day month weekday
                          </p>
                        </Field>
                      )}

                      {/* Repeat count (0 = unlimited) — not shown for 'once' */}
                      {scheduleType !== 'once' && (
                        <Field>
                          <FieldLabel>Repeat count</FieldLabel>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              placeholder="0"
                              className="w-28"
                              {...register('schedule_repeat_count', { valueAsNumber: true })}
                            />
                            <p className="text-xs text-muted-foreground">
                              0 = no limit (runs until disabled)
                            </p>
                          </div>
                        </Field>
                      )}
                    </div>
                  )}
                </div>
              </FormSection>
            </div>
          </ScrollArea>

          <DialogFooter className="px-6 mb-0">
            {mode === 'create' && (
              <Button type="button" variant="destructive" size="sm" onClick={removeDraftAndClose}>
                Remove Draft
              </Button>
            )}
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {mode === 'create' ? 'Create Job' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {mappingDialogOpen && (
        <ColumnMappingDialog
          onOpenChange={setMappingDialogOpen}
          sourceHeaders={actionPreview?.headers ?? []}
          initialMapping={parseMappingJson(actionColumnMapping)}
          keyColumns={(actionKeyColumns ?? '')
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)}
          onSave={(mapping) => setValue('action_column_mapping', JSON.stringify(mapping))}
        />
      )}
    </Dialog>
  )
}
