import { useCallback, useRef } from 'react'
import type { Header } from '@tanstack/react-table'

interface UseColumnResizeOptions {
  onResize?: (columnId: string, width: number) => void
  minWidth?: number
  maxWidth?: number
}

export function useColumnResize(options: UseColumnResizeOptions = {}) {
  const { onResize, minWidth = 40, maxWidth = 800 } = options
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const getResizeHandler = useCallback(
    <TData>(header: Header<TData, unknown>) =>
      (e: React.MouseEvent | React.TouchEvent) => {
        if (!header.column.getCanResize()) return

        e.preventDefault()
        e.stopPropagation()

        const startX = 'touches' in e ? e.touches[0].clientX : e.clientX
        startXRef.current = startX
        startWidthRef.current = header.column.getSize()

        function onMove(moveEvent: MouseEvent | TouchEvent) {
          const clientX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX
          const delta = clientX - startXRef.current
          const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta))
          header.column.resetSize()
          // TanStack table internal resize
          header.getResizeHandler()(moveEvent as unknown as MouseEvent)
          onResize?.(header.column.id, newWidth)
        }

        function onUp() {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          document.removeEventListener('touchmove', onMove)
          document.removeEventListener('touchend', onUp)
        }

        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
        document.addEventListener('touchmove', onMove)
        document.addEventListener('touchend', onUp)
      },
    [maxWidth, minWidth, onResize]
  )

  return { getResizeHandler }
}
