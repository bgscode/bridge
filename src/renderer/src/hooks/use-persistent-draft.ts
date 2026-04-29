import { useCallback, useMemo } from 'react'

interface PersistentDraft<T> {
  readDraft: () => T | null
  saveDraft: (value: T) => void
  clearDraft: () => void
}

export function usePersistentDraft<T>(storageKey: string): PersistentDraft<T> {
  const readDraft = useCallback((): T | null => {
    if (typeof window === 'undefined') return null

    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null

    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }, [storageKey])

  const saveDraft = useCallback(
    (value: T): void => {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    },
    [storageKey]
  )

  const clearDraft = useCallback((): void => {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(storageKey)
  }, [storageKey])

  return useMemo(() => ({ readDraft, saveDraft, clearDraft }), [readDraft, saveDraft, clearDraft])
}
