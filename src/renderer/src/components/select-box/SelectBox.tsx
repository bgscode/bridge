import {
  type KeyboardEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cva } from 'class-variance-authority'
import {
  CheckIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  XIcon
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import { useAsyncOptions, usePersistence } from './hooks'
import type { MultiSelectProps, SelectBoxOption, SelectBoxProps, SingleSelectProps } from './types'

// ─── Trigger Variants ──────────────────────────────────────────────────────────

const triggerVariants = cva(
  'group/select-trigger flex w-full items-center justify-between gap-1.5 rounded-lg border bg-transparent text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50',
  {
    variants: {
      variant: {
        default: 'border-input',
        outline: 'border-border bg-background dark:border-input dark:bg-input/30',
        ghost: 'border-transparent hover:bg-muted dark:hover:bg-muted/50'
      },
      size: {
        sm: 'h-7 px-2 text-xs rounded-[min(var(--radius-md),12px)]',
        default: 'h-8 px-2.5 py-1',
        lg: 'h-9 px-3'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

// ─── Constants ─────────────────────────────────────────────────────────────────

const VIRTUALIZATION_THRESHOLD = 100
const DEFAULT_ITEM_SIZE = 32

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isMulti(props: SelectBoxProps): props is MultiSelectProps {
  return props.multiple === true
}

function defaultFilter(option: SelectBoxOption, search: string): boolean {
  return option.label.toLowerCase().includes(search.toLowerCase())
}

function highlightMatch(text: string, search: string): ReactNode {
  if (!search) return text
  const idx = text.toLowerCase().indexOf(search.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent font-semibold text-foreground">
        {text.slice(idx, idx + search.length)}
      </mark>
      {text.slice(idx + search.length)}
    </>
  )
}

// ─── SelectBox ─────────────────────────────────────────────────────────────────

export function SelectBox(props: SelectBoxProps): ReactNode {
  const {
    options: staticOptions = [],
    async: asyncConfig,
    placeholder = 'Select…',
    disabled = false,
    searchable = true,
    clearable = false,
    creatable = false,
    onCreateOption,
    filterFn,
    renderOption,
    renderValue,
    variant = 'default',
    size = 'default',
    className,
    dropdownClassName,
    dropdownWidth,
    groups,
    error: errorProp,
    persistKey,
    name,
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
    virtualized: virtualizedProp,
    estimateSize = DEFAULT_ITEM_SIZE,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    tabIndex
  } = props

  // ── Internal open state ────────────────────────────────────────────────────

  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen ?? internalOpen
  const setIsOpen = useCallback(
    (v: boolean) => {
      controlledOnOpenChange?.(v)
      if (controlledOpen === undefined) setInternalOpen(v)
    },
    [controlledOpen, controlledOnOpenChange]
  )

  // ── Selection state ────────────────────────────────────────────────────────

  const multi = isMulti(props)
  const defaultSingle = (props as SingleSelectProps).defaultValue ?? null
  const defaultMulti = (props as MultiSelectProps).defaultValue ?? []

  const [persistedSingle, setPersistedSingle] = usePersistence<string | number | null>(
    !multi ? persistKey : undefined,
    multi ? null : defaultSingle
  )
  const [persistedMulti, setPersistedMulti] = usePersistence<(string | number)[]>(
    multi ? persistKey : undefined,
    multi ? defaultMulti : []
  )

  // Controlled vs uncontrolled value
  const singleValue = multi ? null : ((props as SingleSelectProps).value ?? persistedSingle)
  const controlledMultiValue = (props as MultiSelectProps).value
  const multiValue = useMemo(
    () => (multi ? (controlledMultiValue ?? persistedMulti) : []),
    [multi, controlledMultiValue, persistedMulti]
  )

  // ── Search state ───────────────────────────────────────────────────────────

  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // ── Async support ──────────────────────────────────────────────────────────

  const {
    options: asyncOptions,
    isLoading,
    error: asyncError,
    hasMore,
    loadMore
  } = useAsyncOptions(asyncConfig, search, isOpen)

  // ── Resolved options ───────────────────────────────────────────────────────

  const sourceOptions = asyncConfig ? asyncOptions : staticOptions

  const filteredOptions = useMemo(() => {
    if (!search || asyncConfig) return sourceOptions
    const filter = filterFn ?? defaultFilter
    return sourceOptions.filter((opt) => filter(opt, search))
  }, [sourceOptions, search, asyncConfig, filterFn])

  // Flatten with groups
  type FlatItem =
    | { type: 'group'; label: string }
    | { type: 'option'; option: SelectBoxOption; index: number }

  const flatItems: FlatItem[] = useMemo(() => {
    if (!groups?.length) {
      return filteredOptions.map((opt, i) => ({ type: 'option' as const, option: opt, index: i }))
    }

    const items: FlatItem[] = []
    let optionIndex = 0

    for (const group of groups) {
      const groupOpts = filteredOptions.filter((o) => o.group === group.key)
      if (groupOpts.length === 0) continue
      items.push({ type: 'group', label: group.label })
      for (const opt of groupOpts) {
        items.push({ type: 'option', option: opt, index: optionIndex++ })
      }
    }

    // Ungrouped items
    const groupedKeys = new Set(groups.map((g) => g.key))
    const ungrouped = filteredOptions.filter((o) => !o.group || !groupedKeys.has(o.group))
    for (const opt of ungrouped) {
      items.push({ type: 'option', option: opt, index: optionIndex++ })
    }

    return items
  }, [filteredOptions, groups])

  // ── Virtualization ─────────────────────────────────────────────────────────

  const shouldVirtualize = virtualizedProp ?? flatItems.length > VIRTUALIZATION_THRESHOLD

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => estimateSize,
    overscan: 8,
    enabled: shouldVirtualize
  })

  // ── Keyboard navigation ────────────────────────────────────────────────────

  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const navigableIndices = useMemo(
    () =>
      flatItems
        .map((item, i) => (item.type === 'option' && !item.option.disabled ? i : -1))
        .filter((i) => i !== -1),
    [flatItems]
  )

  const scrollToIndex = useCallback(
    (index: number) => {
      if (shouldVirtualize) {
        virtualizer.scrollToIndex(index, { align: 'auto' })
      } else {
        const el = listRef.current?.querySelector(`[data-index="${index}"]`)
        el?.scrollIntoView({ block: 'nearest' })
      }
    },
    [shouldVirtualize, virtualizer]
  )

  // ── Selection handlers ─────────────────────────────────────────────────────

  const isSelected = useCallback(
    (val: string | number): boolean => {
      if (multi) return multiValue.includes(val)
      return singleValue === val
    },
    [multi, singleValue, multiValue]
  )

  const selectOption = useCallback(
    (option: SelectBoxOption) => {
      if (option.disabled) return

      if (multi) {
        const mProps = props as MultiSelectProps
        const current = multiValue
        let next: (string | number)[]

        if (current.includes(option.value)) {
          next = current.filter((v) => v !== option.value)
        } else {
          if (mProps.maxSelections && current.length >= mProps.maxSelections) return
          next = [...current, option.value]
        }

        if (mProps.value === undefined) setPersistedMulti(next)
        mProps.onChange?.(
          next,
          sourceOptions.filter((o) => next.includes(o.value))
        )
      } else {
        const sProps = props as SingleSelectProps
        const next = singleValue === option.value ? null : option.value
        const nextOpt = next !== null ? option : null

        if (sProps.value === undefined) setPersistedSingle(next)
        sProps.onChange?.(next, nextOpt)
        setIsOpen(false)
      }
    },
    [
      multi,
      multiValue,
      singleValue,
      props,
      sourceOptions,
      setIsOpen,
      setPersistedMulti,
      setPersistedSingle
    ]
  )

  const clearSelection = useCallback(() => {
    if (multi) {
      const mProps = props as MultiSelectProps
      if (mProps.value === undefined) setPersistedMulti([])
      mProps.onChange?.([], [])
    } else {
      const sProps = props as SingleSelectProps
      if (sProps.value === undefined) setPersistedSingle(null)
      sProps.onChange?.(null, null)
    }
  }, [multi, props, setPersistedMulti, setPersistedSingle])

  const selectAll = useCallback(() => {
    if (!multi) return
    const mProps = props as MultiSelectProps
    const allValues = filteredOptions.filter((o) => !o.disabled).map((o) => o.value)
    const limited = mProps.maxSelections ? allValues.slice(0, mProps.maxSelections) : allValues
    if (mProps.value === undefined) setPersistedMulti(limited)
    mProps.onChange?.(
      limited,
      sourceOptions.filter((o) => limited.includes(o.value))
    )
  }, [multi, props, filteredOptions, sourceOptions, setPersistedMulti])

  const deselectAll = useCallback(() => {
    if (!multi) return
    clearSelection()
  }, [multi, clearSelection])

  // ── Create option ──────────────────────────────────────────────────────────

  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = useCallback(async () => {
    if (!creatable || !onCreateOption || !search.trim()) return
    setIsCreating(true)
    try {
      const newOpt = await onCreateOption(search.trim())
      selectOption(newOpt)
      setSearch('')
    } finally {
      setIsCreating(false)
    }
  }, [creatable, onCreateOption, search, selectOption])

  // ── Infinite scroll ────────────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    if (!asyncConfig || !hasMore || isLoading) return
    const el = listRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight - scrollTop - clientHeight < 50) {
      loadMore()
    }
  }, [asyncConfig, hasMore, isLoading, loadMore])

  // ── Keyboard handler ───────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!isOpen) return

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const currentPos = navigableIndices.indexOf(highlightedIndex)
          const nextPos = currentPos < navigableIndices.length - 1 ? currentPos + 1 : 0
          const next = navigableIndices[nextPos]
          if (next !== undefined) {
            setHighlightedIndex(next)
            scrollToIndex(next)
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const currentPos = navigableIndices.indexOf(highlightedIndex)
          const prevPos = currentPos > 0 ? currentPos - 1 : navigableIndices.length - 1
          const prev = navigableIndices[prevPos]
          if (prev !== undefined) {
            setHighlightedIndex(prev)
            scrollToIndex(prev)
          }
          break
        }
        case 'Enter': {
          e.preventDefault()
          const item = flatItems[highlightedIndex]
          if (item?.type === 'option') {
            selectOption(item.option)
          } else if (creatable && search.trim() && filteredOptions.length === 0) {
            handleCreate()
          }
          break
        }
        case 'Escape': {
          e.preventDefault()
          setIsOpen(false)
          triggerRef.current?.focus()
          break
        }
        case 'Backspace': {
          if (multi && !search && multiValue.length > 0) {
            const mProps = props as MultiSelectProps
            const next = multiValue.slice(0, -1)
            if (mProps.value === undefined) setPersistedMulti(next)
            mProps.onChange?.(
              next,
              sourceOptions.filter((o) => next.includes(o.value))
            )
          }
          break
        }
      }
    },
    [
      isOpen,
      highlightedIndex,
      navigableIndices,
      flatItems,
      selectOption,
      creatable,
      search,
      filteredOptions.length,
      handleCreate,
      setIsOpen,
      multi,
      multiValue,
      props,
      sourceOptions,
      scrollToIndex,
      setPersistedMulti
    ]
  )

  // ── Reset state on close ───────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) {
      setSearch('')
      setHighlightedIndex(-1)
    } else {
      // Focus search input when opened
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [isOpen])

  // ── Display values ─────────────────────────────────────────────────────────

  const selectedOptions = useMemo(() => {
    const allOpts = asyncConfig ? [...asyncOptions, ...staticOptions] : staticOptions
    if (multi) {
      return multiValue
        .map((v) => allOpts.find((o) => o.value === v))
        .filter(Boolean) as SelectBoxOption[]
    }
    if (singleValue !== null && singleValue !== undefined) {
      const found = allOpts.find((o) => o.value === singleValue)
      return found ? [found] : []
    }
    return []
  }, [multi, singleValue, multiValue, asyncOptions, staticOptions, asyncConfig])

  const hasValue = multi ? multiValue.length > 0 : singleValue !== null && singleValue !== undefined

  // ── Multi select tag display ───────────────────────────────────────────────

  const maxVisibleTags = multi ? ((props as MultiSelectProps).maxVisibleTags ?? 3) : 0
  const showSelectAll = multi ? ((props as MultiSelectProps).showSelectAll ?? false) : false
  const allSelected =
    multi &&
    filteredOptions.length > 0 &&
    filteredOptions.every((o) => o.disabled || multiValue.includes(o.value))

  // ── Trigger content ────────────────────────────────────────────────────────

  function renderTriggerContent(): ReactNode {
    if (!hasValue) {
      return <span className="text-muted-foreground">{placeholder}</span>
    }

    if (multi) {
      const visible = selectedOptions.slice(0, maxVisibleTags)
      const remaining = selectedOptions.length - maxVisibleTags
      return (
        <span className="flex flex-1 flex-wrap items-center gap-1 overflow-hidden">
          {visible.map((opt) => (
            <Badge key={opt.value} variant="secondary" className="max-w-30 gap-0.5 truncate pr-0.5">
              <span className="truncate">{renderValue ? renderValue(opt) : opt.label}</span>
              <span
                role="button"
                tabIndex={-1}
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  selectOption(opt)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    selectOption(opt)
                  }
                }}
                aria-label={`Remove ${opt.label}`}
              >
                <XIcon className="size-3" />
              </span>
            </Badge>
          ))}
          {remaining > 0 && (
            <Badge variant="outline" className="shrink-0">
              +{remaining} more
            </Badge>
          )}
        </span>
      )
    }

    const opt = selectedOptions[0]
    if (!opt) return <span className="text-muted-foreground">{placeholder}</span>
    return (
      <span className="flex items-center gap-1.5 truncate">
        {opt.icon}
        <span className="truncate">{renderValue ? renderValue(opt) : opt.label}</span>
      </span>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const errorState = errorProp || !!asyncError
  const errorMsg = asyncError || (props as { errorMessage?: string }).errorMessage

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      {/* Hidden input for form integration */}
      {name && (
        <input
          type="hidden"
          name={name}
          value={multi ? JSON.stringify(multiValue) : (singleValue ?? '')}
        />
      )}

      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-invalid={errorState || undefined}
          disabled={disabled}
          tabIndex={tabIndex}
          data-slot="select-box-trigger"
          className={cn(triggerVariants({ variant, size }), className)}
        >
          <span className="flex flex-1 items-center gap-1 overflow-hidden">
            {renderTriggerContent()}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            {clearable && hasValue && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  clearSelection()
                }}
                aria-label="Clear selection"
              >
                <XIcon className="size-3.5 text-muted-foreground" />
              </span>
            )}
            <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        data-slot="select-box-content"
        className={cn('w-(--radix-popover-trigger-width) p-0', dropdownClassName)}
        style={
          dropdownWidth
            ? { width: typeof dropdownWidth === 'number' ? `${dropdownWidth}px` : dropdownWidth }
            : undefined
        }
        side="bottom"
        align="start"
        sideOffset={6}
        avoidCollisions
        collisionPadding={8}
        sticky="partial"
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Search input */}
        {searchable && (
          <div className="flex items-center gap-2 border-b px-2.5 py-2">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              className="h-5 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search options"
              autoComplete="off"
            />
            {search && (
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-muted"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <XIcon className="size-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}

        {/* Select all / Deselect all for multi */}
        {multi && showSelectAll && filteredOptions.length > 0 && (
          <div className="flex items-center justify-between border-b px-2.5 py-1.5">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={allSelected ? deselectAll : selectAll}
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-xs text-muted-foreground">{multiValue.length} selected</span>
          </div>
        )}

        {/* Error state */}
        {errorState && errorMsg && (
          <div className="px-2.5 py-3 text-center text-sm text-destructive">{errorMsg}</div>
        )}

        {/* Options list */}
        <div
          ref={listRef}
          role="listbox"
          aria-multiselectable={multi || undefined}
          className="max-h-72 overflow-y-auto overscroll-contain"
          onScroll={handleScroll}
          onWheelCapture={(e) => {
            // Keep scroll inside the list — Radix PopoverContent lives inside a
            // portal that otherwise lets wheel events bubble to the app shell
            // and sometimes gets intercepted before our container sees them.
            const el = e.currentTarget
            const { scrollTop, scrollHeight, clientHeight } = el
            const delta = e.deltaY
            const atTop = scrollTop === 0
            const atBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight
            if ((delta < 0 && !atTop) || (delta > 0 && !atBottom)) {
              e.stopPropagation()
            }
          }}
        >
          {isLoading && flatItems.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6">
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          ) : flatItems.length === 0 && !isCreating ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {creatable && search.trim() ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-sm hover:text-foreground"
                  onClick={handleCreate}
                >
                  <PlusIcon className="size-4" />
                  Create &ldquo;{search.trim()}&rdquo;
                </button>
              ) : (
                'No options found'
              )}
            </div>
          ) : shouldVirtualize ? (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = flatItems[virtualRow.index]
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                  >
                    {item.type === 'group' ? (
                      <GroupLabel label={item.label} />
                    ) : (
                      <OptionItem
                        option={item.option}
                        selected={isSelected(item.option.value)}
                        highlighted={virtualRow.index === highlightedIndex}
                        search={search}
                        renderOption={renderOption}
                        onSelect={() => selectOption(item.option)}
                        onHover={() => setHighlightedIndex(virtualRow.index)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            flatItems.map((item, idx) =>
              item.type === 'group' ? (
                <GroupLabel key={`group-${item.label}`} label={item.label} />
              ) : (
                <OptionItem
                  key={item.option.value}
                  option={item.option}
                  selected={isSelected(item.option.value)}
                  highlighted={idx === highlightedIndex}
                  search={search}
                  renderOption={renderOption}
                  onSelect={() => selectOption(item.option)}
                  onHover={() => setHighlightedIndex(idx)}
                  data-index={idx}
                />
              )
            )
          )}

          {/* Infinite scroll loading indicator */}
          {isLoading && flatItems.length > 0 && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading more…</span>
            </div>
          )}

          {/* Creatable option at the bottom */}
          {creatable &&
            search.trim() &&
            filteredOptions.length > 0 &&
            !filteredOptions.some((o) => o.label.toLowerCase() === search.trim().toLowerCase()) && (
              <button
                type="button"
                className="flex w-full items-center gap-1.5 border-t px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={handleCreate}
                disabled={isCreating}
              >
                {isCreating ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <PlusIcon className="size-4" />
                )}
                Create &ldquo;{search.trim()}&rdquo;
              </button>
            )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function GroupLabel({ label }: { label: string }): ReactNode {
  return (
    <div
      data-slot="select-box-group-label"
      className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
    >
      {label}
    </div>
  )
}

interface OptionItemProps {
  option: SelectBoxOption
  selected: boolean
  highlighted: boolean
  search: string
  renderOption?: SelectBoxProps['renderOption']
  onSelect: () => void
  onHover: () => void
  'data-index'?: number
}

const OptionItem = memo(function OptionItem({
  option,
  selected,
  highlighted,
  search,
  renderOption,
  onSelect,
  onHover,
  ...rest
}: OptionItemProps) {
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={option.disabled || undefined}
      data-highlighted={highlighted || undefined}
      data-slot="select-box-option"
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-hidden select-none',
        highlighted && 'bg-accent text-accent-foreground',
        option.disabled && 'pointer-events-none opacity-50',
        !highlighted && !option.disabled && 'hover:bg-accent/50'
      )}
      onClick={onSelect}
      onMouseEnter={onHover}
      {...rest}
    >
      {renderOption ? (
        renderOption(option, { selected, highlighted })
      ) : (
        <>
          {option.icon && <span className="shrink-0">{option.icon}</span>}
          <span className="flex-1 truncate">{highlightMatch(option.label, search)}</span>
          {selected && <CheckIcon className="size-4 shrink-0 text-primary" />}
        </>
      )}
    </div>
  )
})
