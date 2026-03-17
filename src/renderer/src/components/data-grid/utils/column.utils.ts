import type { Column } from '@tanstack/react-table'
import type { DataGridColumnState } from '../types'

const STORAGE_PREFIX = 'datagrid_state_'

// ─── Persist column state to localStorage ────────────────────────────────────

export function saveColumnState(key: string, state: Partial<DataGridColumnState>): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state))
  } catch {
    // localStorage not available
  }
}

export function loadColumnState(key: string): Partial<DataGridColumnState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as Partial<DataGridColumnState>
  } catch {
    return null
  }
}

export function clearColumnState(key: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    // ignore
  }
}

// ─── Get pin class for a column cell ─────────────────────────────────────────

export function getPinStyles<TData>(column: Column<TData, unknown>): React.CSSProperties {
  const isPinned = column.getIsPinned()
  if (!isPinned) return {}

  return {
    position: 'sticky',
    left: isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
    right: isPinned === 'right' ? `${column.getAfter('right')}px` : undefined,
    backgroundColor: 'var(--color-background)',
    zIndex: 1
  }
}

export function getPinClassName<TData>(column: Column<TData, unknown>): string {
  const isPinned = column.getIsPinned()
  if (!isPinned) return ''
  return isPinned === 'left'
    ? 'transition-colors shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]'
    : 'transition-colors shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.15)]'
}

// ─── Default column order from column defs ───────────────────────────────────

export function getDefaultColumnOrder(columns: { id?: string; accessorKey?: unknown }[]): string[] {
  return columns.map((c) => c.id ?? String(c.accessorKey ?? '')).filter(Boolean)
}

// Re-export React for styles type
import type React from 'react'
export {}
