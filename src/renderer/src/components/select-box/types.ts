import type { ReactNode } from 'react'

// ─── Option Types ──────────────────────────────────────────────────────────────

export interface SelectBoxOption<T = unknown> {
  /** Unique value for the option */
  value: string | number
  /** Display label */
  label: string
  /** Whether the option is disabled */
  disabled?: boolean
  /** Optional group key for grouping */
  group?: string
  /** Optional icon or avatar to display */
  icon?: ReactNode
  /** Arbitrary extra data attached to the option */
  data?: T
}

export interface SelectBoxGroup {
  label: string
  key: string
}

// ─── Async Types ───────────────────────────────────────────────────────────────

export interface AsyncConfig {
  /** Fetch function: receives search string and page number, returns options + hasMore flag */
  fetchOptions: (
    search: string,
    page: number
  ) => Promise<{ options: SelectBoxOption[]; hasMore: boolean }>
  /** Debounce delay in ms for search input (default: 300) */
  debounceMs?: number
  /** Fetch initial options on mount */
  fetchOnMount?: boolean
  /** Async loading of default values by their value keys */
  fetchDefaultValues?: (values: (string | number)[]) => Promise<SelectBoxOption[]>
}

// ─── Variant / Visual ──────────────────────────────────────────────────────────

export type SelectBoxVariant = 'default' | 'outline' | 'ghost'
export type SelectBoxSize = 'sm' | 'default' | 'lg'

// ─── Core Props ────────────────────────────────────────────────────────────────

interface SelectBoxBaseProps {
  /** Static options (ignored when async is provided) */
  options?: SelectBoxOption[]
  /** Async configuration for remote data */
  async?: AsyncConfig
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Searchable — show search input in dropdown */
  searchable?: boolean
  /** Clearable — show clear button */
  clearable?: boolean
  /** Allow creating new options */
  creatable?: boolean
  /** Callback when a new option is created */
  onCreateOption?: (input: string) => SelectBoxOption | Promise<SelectBoxOption>
  /** Custom filter function for client-side filtering */
  filterFn?: (option: SelectBoxOption, search: string) => boolean
  /** Custom option renderer */
  renderOption?: (
    option: SelectBoxOption,
    state: { selected: boolean; highlighted: boolean }
  ) => ReactNode
  /** Custom selected-value renderer */
  renderValue?: (option: SelectBoxOption) => ReactNode
  /** Visual variant */
  variant?: SelectBoxVariant
  /** Size */
  size?: SelectBoxSize
  /** Custom className for the trigger */
  className?: string
  /** Custom className for the dropdown */
  dropdownClassName?: string
  /** Dropdown width (default: match trigger width) */
  dropdownWidth?: number | string
  /** Group definitions */
  groups?: SelectBoxGroup[]
  /** Error state */
  error?: boolean
  /** Error message */
  errorMessage?: string
  /** Persist selected value(s) to localStorage under this key */
  persistKey?: string
  /** Name attribute for form integration */
  name?: string
  /** Whether the popover is open (controlled) */
  open?: boolean
  /** Callback when popover open state changes */
  onOpenChange?: (open: boolean) => void
  /** Enable virtualization (default: true when > 100 options) */
  virtualized?: boolean
  /** Estimated item height for virtualization (default: 32) */
  estimateSize?: number
  /** ARIA label */
  'aria-label'?: string
  /** ARIA labelledby */
  'aria-labelledby'?: string
  /** Tab index for the trigger */
  tabIndex?: number
}

// ─── Single Select Props ───────────────────────────────────────────────────────

export interface SingleSelectProps extends SelectBoxBaseProps {
  multiple?: false
  /** Controlled value */
  value?: string | number | null
  /** Default uncontrolled value */
  defaultValue?: string | number | null
  /** Change callback */
  onChange?: (value: string | number | null, option: SelectBoxOption | null) => void
}

// ─── Multi Select Props ────────────────────────────────────────────────────────

export interface MultiSelectProps extends SelectBoxBaseProps {
  multiple: true
  /** Controlled values */
  value?: (string | number)[]
  /** Default uncontrolled values */
  defaultValue?: (string | number)[]
  /** Change callback */
  onChange?: (values: (string | number)[], options: SelectBoxOption[]) => void
  /** Max number of selections allowed */
  maxSelections?: number
  /** Max visible tags before "+X more" */
  maxVisibleTags?: number
  /** Show select all / deselect all */
  showSelectAll?: boolean
}

// ─── Union Type ────────────────────────────────────────────────────────────────

export type SelectBoxProps = SingleSelectProps | MultiSelectProps

// ─── Internal State ────────────────────────────────────────────────────────────

export interface SelectBoxState {
  isOpen: boolean
  search: string
  highlightedIndex: number
  options: SelectBoxOption[]
  isLoading: boolean
  error: string | null
  page: number
  hasMore: boolean
}
