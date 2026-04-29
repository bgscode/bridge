import { JSX, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Activity, Clock, RotateCcw, Save, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AppSettings } from '@shared/index'

// ─── Schema ────────────────────────────────────────────────────────────────────

const schema = z.object({
  monitor_enabled: z.boolean(),
  monitor_online_interval: z.number().min(30).max(3600),
  monitor_offline_base: z.number().min(5).max(600),
  monitor_backoff_max: z.number().min(30).max(7200),
  monitor_workers: z.number().min(1).max(200),
  monitor_connection_timeout: z.number().min(3).max(120),
  monitor_startup_test: z.boolean(),
  job_concurrent_connections: z.number().min(1).max(100),
  job_query_timeout: z.number().min(5).max(600),
  job_max_retries: z.number().min(0).max(10),
  excel_sheet_row_threshold: z.number().min(1000).max(1_048_576),
  excel_sheet_name_source: z.enum(['connection_name', 'store_name', 'store_code']),
  excel_create_empty_sheets: z.boolean()
})

type FormValues = z.infer<typeof schema>

// ─── Sub-components ────────────────────────────────────────────────────────────

interface SectionProps {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}

function Section({ icon, title, description, children }: SectionProps): JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3.5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold leading-none">{title}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        </div>
      </div>
      <div className="divide-y">{children}</div>
    </div>
  )
}

interface SettingRowProps {
  label: string
  description: string
  badge?: string
  error?: string
  children: ReactNode
}

function SettingRow({ label, description, badge, error, children }: SettingRowProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {badge && (
            <Badge
              variant="secondary"
              className="text-muted-foreground h-4 px-1.5 text-[10px] font-normal"
            >
              {badge}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

interface NumberInputProps {
  unit?: string
  children: ReactNode
}

function NumberInputWithUnit({ unit, children }: NumberInputProps): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      {unit && <span className="text-muted-foreground w-4 text-xs">{unit}</span>}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage(): JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      monitor_enabled: true,
      monitor_startup_test: true
    }
  })

  const monitorEnabled = watch('monitor_enabled')
  const startupTest = watch('monitor_startup_test')
  const sheetNameSource = watch('excel_sheet_name_source')
  const createEmptySheets = watch('excel_create_empty_sheets')

  useEffect(() => {
    window.api.settings.getAll().then((s: AppSettings) => {
      reset(s)
    })
    // reset is a stable RHF reference — only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(data: FormValues): Promise<void> {
    const updated = await window.api.settings.setMany(data)
    reset(updated)
    toast.success('Settings saved — monitor restarted with new config.')
  }

  function handleReset(): void {
    window.api.settings.getAll().then((s: AppSettings) => {
      reset(s)
    })
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      {/* Page header */}
      <div className="border-b px-6 py-5">
        <h1 className="text-base font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage monitor behaviour and performance.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4 p-6" style={{ maxWidth: 680 }}>
          {/* Check Intervals */}
          <Section
            icon={<Clock className="size-3.5" />}
            title="Check Intervals"
            description="How often connections are polled in the background"
          >
            <SettingRow
              label="Online check interval"
              description="Re-test frequency for connections that are currently reachable"
              badge="default 300 s"
              error={errors.monitor_online_interval?.message}
            >
              <NumberInputWithUnit unit="s">
                <Input
                  type="number"
                  min={30}
                  max={3600}
                  className="w-20 text-right tabular-nums"
                  {...register('monitor_online_interval', { valueAsNumber: true })}
                />
              </NumberInputWithUnit>
            </SettingRow>

            <SettingRow
              label="Offline retry base"
              description="Initial wait before retrying an offline connection — doubles on each attempt"
              badge="default 60 s"
              error={errors.monitor_offline_base?.message}
            >
              <NumberInputWithUnit unit="s">
                <Input
                  type="number"
                  min={10}
                  max={600}
                  className="w-20 text-right tabular-nums"
                  {...register('monitor_offline_base', { valueAsNumber: true })}
                />
              </NumberInputWithUnit>
            </SettingRow>

            <SettingRow
              label="Max backoff cap"
              description="Ceiling for the exponential backoff — retries will never wait longer than this"
              badge="default 1800 s"
              error={errors.monitor_backoff_max?.message}
            >
              <NumberInputWithUnit unit="s">
                <Input
                  type="number"
                  min={60}
                  max={7200}
                  className="w-20 text-right tabular-nums"
                  {...register('monitor_backoff_max', { valueAsNumber: true })}
                />
              </NumberInputWithUnit>
            </SettingRow>
          </Section>

          {/* Performance */}
          <Section
            icon={<Zap className="size-3.5" />}
            title="Performance"
            description="Concurrency and timeout limits for the test runner"
          >
            <SettingRow
              label="Parallel workers"
              description="Maximum number of connections tested at the same time"
              badge="default 10"
              error={errors.monitor_workers?.message}
            >
              <Input
                type="number"
                min={1}
                max={200}
                className="w-20 text-right tabular-nums"
                {...register('monitor_workers', { valueAsNumber: true })}
              />
            </SettingRow>

            <SettingRow
              label="Connection timeout"
              description="How long to wait for a SQL Server response before marking it offline"
              badge="default 15 s"
              error={errors.monitor_connection_timeout?.message}
            >
              <NumberInputWithUnit unit="s">
                <Input
                  type="number"
                  min={5}
                  max={120}
                  className="w-20 text-right tabular-nums"
                  {...register('monitor_connection_timeout', { valueAsNumber: true })}
                />
              </NumberInputWithUnit>
            </SettingRow>
          </Section>

          {/* Job Execution */}
          <Section
            icon={<Zap className="size-3.5" />}
            title="Job Execution"
            description="Configure concurrent processing and retry behavior for data sync jobs"
          >
            <SettingRow
              label="Concurrent connections"
              description="Maximum number of database connections to process at the same time during a job run"
              badge="default 5"
              error={errors.job_concurrent_connections?.message}
            >
              <Input
                type="number"
                min={1}
                max={100}
                className="w-20 text-right tabular-nums"
                {...register('job_concurrent_connections', { valueAsNumber: true })}
              />
            </SettingRow>

            <SettingRow
              label="Job query timeout"
              description="How long each SQL query can run before the job marks that connection as timed out"
              badge="default 30 s"
              error={errors.job_query_timeout?.message}
            >
              <NumberInputWithUnit unit="s">
                <Input
                  type="number"
                  min={5}
                  max={600}
                  className="w-20 text-right tabular-nums"
                  {...register('job_query_timeout', { valueAsNumber: true })}
                />
              </NumberInputWithUnit>
            </SettingRow>

            <SettingRow
              label="Max retry attempts"
              description="Number of times to retry a failed connection before marking it as failed (0 = no retries)"
              badge="default 0"
              error={errors.job_max_retries?.message}
            >
              <Input
                type="number"
                min={0}
                max={10}
                className="w-20 text-right tabular-nums"
                {...register('job_max_retries', { valueAsNumber: true })}
              />
            </SettingRow>

            <SettingRow
              label="Excel sheet row threshold"
              description="Split data into a new sheet (_2, _3…) once a sheet hits this row count. Excel’s hard cap is 1,048,576 rows per sheet."
              badge="default 800000 rows"
              error={errors.excel_sheet_row_threshold?.message}
            >
              <NumberInputWithUnit unit="rows">
                <Input
                  type="number"
                  min={1000}
                  max={1_048_576}
                  step={1}
                  className="w-28 text-right tabular-nums"
                  {...register('excel_sheet_row_threshold', { valueAsNumber: true })}
                />
              </NumberInputWithUnit>
            </SettingRow>

            <SettingRow
              label="Sheet & file name source"
              description="What each generated Excel sheet / CSV file is named after. Falls back to the connection name when a linked store is missing."
              badge="default Connection Name"
              error={errors.excel_sheet_name_source?.message}
            >
              <select
                value={sheetNameSource ?? 'connection_name'}
                onChange={(e) =>
                  setValue(
                    'excel_sheet_name_source',
                    e.target.value as FormValues['excel_sheet_name_source'],
                    { shouldDirty: true }
                  )
                }
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="connection_name">Connection Name</option>
                <option value="store_name">Store Name</option>
                <option value="store_code">Store Code</option>
              </select>
            </SettingRow>

            <SettingRow
              label="Create empty sheets"
              description="When a connection returns no rows, still create an empty sheet so the workbook has a consistent structure across every selected connection."
            >
              <button
                type="button"
                role="switch"
                aria-checked={createEmptySheets}
                onClick={() =>
                  setValue('excel_create_empty_sheets', !createEmptySheets, {
                    shouldDirty: true
                  })
                }
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
                  'transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  createEmptySheets ? 'bg-primary' : 'bg-input'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none block size-4 rounded-full bg-background shadow ring-0 transition-transform duration-200',
                    createEmptySheets ? 'translate-x-4' : 'translate-x-0'
                  )}
                />
              </button>
            </SettingRow>
          </Section>

          {/* Startup */}
          <Section
            icon={<Activity className="size-3.5" />}
            title="Startup"
            description="Actions performed automatically when the app launches"
          >
            <SettingRow
              label="Enable background monitoring"
              description="Turn off to completely pause all connection polling (useful when running heavy jobs)"
            >
              <button
                type="button"
                role="switch"
                aria-checked={monitorEnabled}
                onClick={() => setValue('monitor_enabled', !monitorEnabled, { shouldDirty: true })}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
                  'transition-colors duration-200 ease-in-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  monitorEnabled ? 'bg-primary' : 'bg-input'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none block size-4 rounded-full bg-background shadow ring-0 transition-transform duration-200 ease-in-out',
                    monitorEnabled ? 'translate-x-4' : 'translate-x-0'
                  )}
                />
              </button>
            </SettingRow>

            <SettingRow
              label="Test connections on startup"
              description="Run a full connection test for all saved connections when the app opens"
            >
              <button
                type="button"
                role="switch"
                aria-checked={startupTest}
                onClick={() =>
                  setValue('monitor_startup_test', !startupTest, { shouldDirty: true })
                }
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
                  'transition-colors duration-200 ease-in-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  startupTest ? 'bg-primary' : 'bg-input'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none block size-4 rounded-full bg-background shadow ring-0 transition-transform duration-200 ease-in-out',
                    startupTest ? 'translate-x-4' : 'translate-x-0'
                  )}
                />
              </button>
            </SettingRow>
          </Section>
        </div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 mt-auto border-t bg-background/90 backdrop-blur-sm">
          <div className="flex items-center justify-between px-6 py-3" style={{ maxWidth: 680 }}>
            <p
              className={cn(
                'text-xs transition-opacity',
                isDirty ? 'text-muted-foreground' : 'opacity-0'
              )}
            >
              Unsaved changes
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!isDirty}
                onClick={handleReset}
              >
                <RotateCcw className="mr-1.5 size-3" />
                Reset
              </Button>
              <Button type="submit" size="sm" disabled={!isDirty || isSubmitting}>
                <Save className="mr-1.5 size-3" />
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
