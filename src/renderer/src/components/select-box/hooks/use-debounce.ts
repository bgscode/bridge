import { useEffect, useRef, useState } from 'react'

/**
 * Debounces a value by the given delay.
 * Returns the debounced value and a flag indicating if a bounce is pending.
 */
export function useDebounce<T>(value: T, delay: number): [T, boolean] {
  const [debounced, setDebounced] = useState(value)
  const [isPending, setIsPending] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value)
      setIsPending(false)
      return
    }

    setIsPending(true)
    timerRef.current = setTimeout(() => {
      setDebounced(value)
      setIsPending(false)
    }, delay)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, delay])

  return [debounced, isPending]
}
