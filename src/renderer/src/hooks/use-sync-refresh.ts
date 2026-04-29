import { useEffect } from 'react'
import { toast } from 'sonner'
import { useConnections } from '@/contexts/use-connections'
import { useJobs } from '@/contexts/use-jobs'
import { useGroups } from '@/contexts/use-groups'
import { useJobGroups } from '@/contexts/use-job-groups'
import { useStores } from '@/contexts/use-stores'
import { useFiscalYears } from '@/contexts/use-fiscal-years'

/**
 * Listens for the `sync:completed` broadcast from the main process and
 * reloads every cached context so the UI reflects freshly-synced data
 * without needing an app restart.
 */
export function useSyncRefresh(): void {
  const { reload: reloadConnections } = useConnections()
  const { reload: reloadJobs } = useJobs()
  const { reload: reloadGroups } = useGroups()
  const { reload: reloadJobGroups } = useJobGroups()
  const { reload: reloadStores } = useStores()
  const { reload: reloadFiscalYears } = useFiscalYears()

  useEffect(() => {
    const off = window.api.sync.onCompleted((result) => {
      reloadConnections()
      reloadJobs()
      reloadGroups()
      reloadJobGroups()
      reloadStores()
      reloadFiscalYears()
      const p = result.pulled
      if (p) {
        toast.message('Data refreshed', {
          description: `${p.connections} connections · ${p.jobs} jobs · ${p.stores} stores`
        })
      }
    })
    return () => {
      off?.()
    }
  }, [
    reloadConnections,
    reloadJobs,
    reloadGroups,
    reloadJobGroups,
    reloadStores,
    reloadFiscalYears
  ])
}
