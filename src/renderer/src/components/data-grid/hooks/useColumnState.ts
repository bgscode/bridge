import { useCallback, useEffect, useState } from 'react'
import type { DataGridColumnState } from '../types'
import { loadColumnState, saveColumnState, clearColumnState } from '../utils/column.utils'

export function useColumnState(persistKey?: string) {
  const [state, setState] = useState<Partial<DataGridColumnState>>(() =>
    persistKey ? (loadColumnState(persistKey) ?? {}) : {}
  )

  const update = useCallback(
    (partial: Partial<DataGridColumnState>) => {
      setState((prev) => {
        const next = { ...prev, ...partial }
        if (persistKey) saveColumnState(persistKey, next)
        return next
      })
    },
    [persistKey]
  )

  const reset = useCallback(() => {
    setState({})
    if (persistKey) clearColumnState(persistKey)
  }, [persistKey])

  // Sync from external storage changes (e.g. other tabs)
  useEffect(() => {
    if (!persistKey) return
    function onStorage(e: StorageEvent) {
      if (e.key === `datagrid_state_${persistKey}`) {
        const loaded = loadColumnState(persistKey!)
        if (loaded) setState(loaded)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [persistKey])

  return { state, update, reset }
}
