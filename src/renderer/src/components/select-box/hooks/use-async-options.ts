import { useCallback, useEffect, useRef, useState } from 'react'
import type { AsyncConfig, SelectBoxOption } from '../types'
import { useDebounce } from './use-debounce'

interface UseAsyncOptionsReturn {
  options: SelectBoxOption[]
  isLoading: boolean
  error: string | null
  hasMore: boolean
  page: number
  loadMore: () => void
  reset: () => void
}

export function useAsyncOptions(
  config: AsyncConfig | undefined,
  search: string,
  isOpen: boolean
): UseAsyncOptionsReturn {
  const [options, setOptions] = useState<SelectBoxOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const abortRef = useRef<AbortController | null>(null)
  const mountFetchedRef = useRef(false)

  const debounceMs = config?.debounceMs ?? 300
  const [debouncedSearch] = useDebounce(search, debounceMs)

  const fetchPage = useCallback(
    async (searchTerm: string, pageNum: number, append: boolean) => {
      if (!config) return

      // Cancel any in-flight request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setIsLoading(true)
      setError(null)

      try {
        const result = await config.fetchOptions(searchTerm, pageNum)

        if (controller.signal.aborted) return

        setOptions((prev) => (append ? [...prev, ...result.options] : result.options))
        setHasMore(result.hasMore)
        setPage(pageNum)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load options')
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    },
    [config]
  )

  // Fetch on mount if configured
  useEffect(() => {
    if (config?.fetchOnMount && !mountFetchedRef.current) {
      mountFetchedRef.current = true
      fetchPage('', 1, false)
    }
  }, [config?.fetchOnMount, fetchPage])

  // Fetch when popover opens or debounced search changes
  useEffect(() => {
    if (!config || !isOpen) return
    fetchPage(debouncedSearch, 1, false)
  }, [debouncedSearch, isOpen, config, fetchPage])

  const loadMore = useCallback(() => {
    if (!config || isLoading || !hasMore) return
    fetchPage(debouncedSearch, page + 1, true)
  }, [config, isLoading, hasMore, debouncedSearch, page, fetchPage])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setOptions([])
    setIsLoading(false)
    setError(null)
    setHasMore(false)
    setPage(1)
  }, [])

  return { options, isLoading, error, hasMore, page, loadMore, reset }
}
