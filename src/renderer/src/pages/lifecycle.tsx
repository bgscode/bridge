import { JSX } from 'react'
import {
  Activity,
  CheckCircle2,
  Circle,
  Clock3,
  Layers,
  Link,
  Settings2,
  Sparkles,
  Wrench,
  XCircle
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useConnections, useFiscalYears, useGroups, useJobs, useStores } from '@/contexts'

interface StageCardProps {
  title: string
  subtitle: string
  value: string
  progress: number
  status: 'good' | 'warn' | 'bad'
}

function StageCard({ title, subtitle, value, progress, status }: StageCardProps): JSX.Element {
  const statusColor =
    status === 'good' ? 'text-emerald-600' : status === 'warn' ? 'text-amber-600' : 'text-rose-600'

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`text-xl font-semibold ${statusColor}`}>{value}</div>
        <Progress value={Math.max(0, Math.min(100, progress))} className="h-2" />
      </CardContent>
    </Card>
  )
}

export default function LifecyclePage(): JSX.Element {
  const { groups } = useGroups()
  const { stores } = useStores()
  const { fiscalYears } = useFiscalYears()
  const { connections } = useConnections()
  const { jobs } = useJobs()

  const onlineConnections = connections.filter((c) => c.status === 'online').length
  const scheduledJobs = jobs.filter((j) => Boolean(j.schedule)).length
  const successfulJobs = jobs.filter((j) => j.status === 'success').length
  const failedJobs = jobs.filter((j) => j.status === 'failed').length
  const monitoredJobs = successfulJobs + failedJobs

  const setupDone =
    (groups.length > 0 ? 1 : 0) + (stores.length > 0 ? 1 : 0) + (fiscalYears.length > 0 ? 1 : 0)
  const setupProgress = Math.round((setupDone / 3) * 100)

  const connectProgress =
    connections.length > 0 ? Math.round((onlineConnections / connections.length) * 100) : 0
  const automateProgress = jobs.length > 0 ? Math.round((scheduledJobs / jobs.length) * 100) : 0
  const reliabilityProgress =
    monitoredJobs > 0 ? Math.round((successfulJobs / monitoredJobs) * 100) : 0

  const lifecycleScore = Math.round(
    (setupProgress + connectProgress + automateProgress + reliabilityProgress) / 4
  )

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Card className="overflow-hidden border-none bg-linear-to-r from-cyan-500 via-blue-500 to-emerald-500 text-white">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4" />
            <Badge variant="secondary" className="bg-white/20 text-white">
              Lifecycle Health
            </Badge>
          </div>
          <CardTitle className="text-2xl">Lifecycle Command Center</CardTitle>
          <CardDescription className="text-white/90">
            Do not remove this page. From here you will track your setup-to-reliability journey.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>Overall Readiness</span>
            <span>{lifecycleScore}%</span>
          </div>
          <Progress
            value={lifecycleScore}
            className="h-2.5 bg-white/20 **:data-[slot=progress-indicator]:bg-white"
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StageCard
          title="1. Setup"
          subtitle="Groups, stores, fiscal years"
          value={`${setupDone}/3 ready`}
          progress={setupProgress}
          status={setupProgress >= 100 ? 'good' : setupProgress >= 50 ? 'warn' : 'bad'}
        />
        <StageCard
          title="2. Connectivity"
          subtitle="Online connection health"
          value={`${onlineConnections}/${connections.length || 0} online`}
          progress={connectProgress}
          status={connectProgress >= 80 ? 'good' : connectProgress >= 40 ? 'warn' : 'bad'}
        />
        <StageCard
          title="3. Automation"
          subtitle="Scheduled job coverage"
          value={`${scheduledJobs}/${jobs.length || 0} scheduled`}
          progress={automateProgress}
          status={automateProgress >= 70 ? 'good' : automateProgress >= 30 ? 'warn' : 'bad'}
        />
        <StageCard
          title="4. Reliability"
          subtitle="Success rate from completed runs"
          value={`${successfulJobs}/${monitoredJobs || 0} successful`}
          progress={reliabilityProgress}
          status={reliabilityProgress >= 85 ? 'good' : reliabilityProgress >= 60 ? 'warn' : 'bad'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">What To Build In Lifecycle</CardTitle>
            <CardDescription>
              The purpose of this page is not just to view, but also for execution planning.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <Layers className="size-4 mt-0.5 text-cyan-600" />
              <div>
                <p className="font-medium">Foundation Templates</p>
                <p className="text-muted-foreground">
                  Automatically seed required groups/stores/fiscal years when a new project starts.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Link className="size-4 mt-0.5 text-blue-600" />
              <div>
                <p className="font-medium">Connection Risk Alerts</p>
                <p className="text-muted-foreground">
                  Proactive warning and retry suggestions for offline or unstable connections.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Clock3 className="size-4 mt-0.5 text-amber-600" />
              <div>
                <p className="font-medium">Schedule Drift Monitor</p>
                <p className="text-muted-foreground">
                  A drift panel showing which scheduled jobs are not running on time.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Wrench className="size-4 mt-0.5 text-emerald-600" />
              <div>
                <p className="font-medium">Fix Suggestions</p>
                <p className="text-muted-foreground">
                  One-click guidance for issues like timeout, auth errors, and missing tables.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Current Lifecycle Checklist</CardTitle>
            <CardDescription>This checklist shows what your next focus should be.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-md border p-2">
              <div className="flex items-center gap-2">
                {setupProgress === 100 ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <Circle className="size-4 text-muted-foreground" />
                )}
                <span>Setup baseline complete</span>
              </div>
              <Badge variant="secondary">{setupProgress}%</Badge>
            </div>

            <div className="flex items-center justify-between rounded-md border p-2">
              <div className="flex items-center gap-2">
                {connectProgress >= 80 ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <Activity className="size-4 text-amber-600" />
                )}
                <span>Connection stability healthy</span>
              </div>
              <Badge variant="secondary">{connectProgress}%</Badge>
            </div>

            <div className="flex items-center justify-between rounded-md border p-2">
              <div className="flex items-center gap-2">
                {automateProgress >= 70 ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <Settings2 className="size-4 text-blue-600" />
                )}
                <span>Critical jobs scheduled</span>
              </div>
              <Badge variant="secondary">{automateProgress}%</Badge>
            </div>

            <div className="flex items-center justify-between rounded-md border p-2">
              <div className="flex items-center gap-2">
                {reliabilityProgress >= 85 ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <XCircle className="size-4 text-rose-600" />
                )}
                <span>Run reliability target</span>
              </div>
              <Badge variant="secondary">{reliabilityProgress}%</Badge>
            </div>

            <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              Priority now: {failedJobs > 0 ? 'Reduce failed jobs' : 'Increase scheduling coverage'}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
