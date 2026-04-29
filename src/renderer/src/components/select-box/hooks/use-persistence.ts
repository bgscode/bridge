import { useEffect, useState } from 'react'

/**
 * Persist and restore a value to/from localStorage.
 * Falls back gracefully if storage is unavailable.
 */
export function usePersistence<T>(
  key: string | undefined,
  defaultValue: T
): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() => {
    if (!key) return defaultValue
    try {
      const stored = localStorage.getItem(key)
      return stored ? (JSON.parse(stored) as T) : defaultValue
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // storage full or unavailable — ignore
    }
  }, [key, state])

  return [state, setState]
}
