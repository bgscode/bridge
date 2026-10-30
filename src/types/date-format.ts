// ─── Date format for query output ─────────────────────────────────────────────
// Shared by the main process (formats SQL values) and the renderer (live preview
// in the job form). Patterns follow Excel conventions so users can type what they
// already know:
//
//   d / dd        day (5 / 05)          ddd / dddd   Mon / Monday
//   m / mm        month (3 / 03)        mmm / mmmm   Mar / March   (also M / MM / MMM / MMMM)
//   yy / yyyy     year (24 / 2024)
//   h / hh        hour (24-hour, or 12-hour when AM/PM is present)  (also H / HH)
//   m / mm        minutes when right after an hour or right before seconds
//   s / ss        seconds
//   AM/PM, am/pm  meridiem
//   [text]        literal text
//
// Example: "dd-mmm-yyyy hh:mm AM/PM" → "05-Mar-2024 02:30 PM"

export const DEFAULT_DATE_FORMAT = 'dd/mm/yyyy'

export const DATE_FORMAT_PRESETS: string[] = [
  'dd/mm/yyyy',
  'dd-mm-yyyy',
  'dd.mm.yyyy',
  'mm/dd/yyyy',
  'yyyy-mm-dd',
  'dd/mm/yy',
  'dd-mmm-yyyy',
  'dd mmm yyyy',
  'dd/mm/yyyy hh:mm',
  'dd/mm/yyyy hh:mm:ss',
  'dd/mm/yyyy hh:mm AM/PM',
  'yyyy-mm-dd hh:mm:ss'
]

export const DATE_FORMAT_MAX_LENGTH = 64

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface DateParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
}

type Token =
  | { kind: 'year'; len: 2 | 4 }
  | { kind: 'month' | 'minute'; len: number }
  | { kind: 'day'; len: number }
  | { kind: 'hour'; len: number }
  | { kind: 'second'; len: number }
  | { kind: 'ampm'; upper: boolean }
  | { kind: 'literal'; text: string }

const TOKEN_RE = /\[[^\]]*\]|AM\/PM|am\/pm|y{4}|y{2}|[mM]{1,4}|d{1,4}|[hH]{1,2}|s{1,2}|[\s\S]/g

function tokenize(pattern: string): Token[] {
  const raw = pattern.match(TOKEN_RE) ?? []
  const tokens: Token[] = raw.map((t): Token => {
    if (t.startsWith('[') && t.endsWith(']')) return { kind: 'literal', text: t.slice(1, -1) }
    if (t === 'AM/PM' || t === 'am/pm') return { kind: 'ampm', upper: t === 'AM/PM' }
    if (t === 'yyyy') return { kind: 'year', len: 4 }
    if (t === 'yy') return { kind: 'year', len: 2 }
    if (/^[mM]+$/.test(t)) return { kind: 'month', len: t.length }
    if (/^d+$/.test(t)) return { kind: 'day', len: t.length }
    if (/^[hH]+$/.test(t)) return { kind: 'hour', len: t.length }
    if (/^s+$/.test(t)) return { kind: 'second', len: t.length }
    return { kind: 'literal', text: t }
  })

  // Excel rule: m/mm right after an hour, or right before seconds, means minutes.
  const neighbour = (from: number, step: 1 | -1): Token | undefined => {
    for (let i = from + step; i >= 0 && i < tokens.length; i += step) {
      if (tokens[i].kind !== 'literal') return tokens[i]
    }
    return undefined
  }
  tokens.forEach((t, i) => {
    if (t.kind !== 'month' || t.len > 2) return
    if (neighbour(i, -1)?.kind === 'hour' || neighbour(i, 1)?.kind === 'second') {
      tokens[i] = { kind: 'minute', len: t.len }
    }
  })
  return tokens
}

const pad = (n: number, len = 2): string => String(n).padStart(len, '0')

function render(parts: DateParts, tokens: Token[]): string {
  const twelveHour = tokens.some((t) => t.kind === 'ampm')
  let out = ''
  for (const t of tokens) {
    switch (t.kind) {
      case 'literal':
        out += t.text
        break
      case 'year':
        out += t.len === 4 ? pad(parts.year, 4) : pad(parts.year % 100)
        break
      case 'month':
        if (t.len >= 4) out += MONTHS[parts.month - 1]
        else if (t.len === 3) out += MONTHS[parts.month - 1].slice(0, 3)
        else out += t.len === 2 ? pad(parts.month) : String(parts.month)
        break
      case 'minute':
        out += t.len === 2 ? pad(parts.minute) : String(parts.minute)
        break
      case 'day': {
        if (t.len >= 3) {
          const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
          out += t.len === 4 ? WEEKDAYS[weekday] : WEEKDAYS[weekday].slice(0, 3)
        } else {
          out += t.len === 2 ? pad(parts.day) : String(parts.day)
        }
        break
      }
      case 'hour': {
        const h = twelveHour ? parts.hour % 12 || 12 : parts.hour
        out += t.len === 2 ? pad(h) : String(h)
        break
      }
      case 'second':
        out += t.len === 2 ? pad(parts.second) : String(parts.second)
        break
      case 'ampm': {
        const m = parts.hour < 12 ? 'AM' : 'PM'
        out += t.upper ? m : m.toLowerCase()
        break
      }
    }
  }
  return out
}

const DATE_STRING_RE = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/

/**
 * Pull calendar parts out of a SQL value. Date objects are read in UTC because
 * the mssql driver (useUTC default) maps SQL datetimes to UTC instants; strings
 * are read literally so their wall-clock time is kept.
 */
function toDateParts(v: unknown): DateParts | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    return {
      year: v.getUTCFullYear(),
      month: v.getUTCMonth() + 1,
      day: v.getUTCDate(),
      hour: v.getUTCHours(),
      minute: v.getUTCMinutes(),
      second: v.getUTCSeconds()
    }
  }
  if (typeof v !== 'string') return null
  const m = DATE_STRING_RE.exec(v)
  if (!m) return null
  const parts: DateParts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0)
  }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null
  return parts
}

const tokenCache = new Map<string, Token[]>()

function tokensFor(pattern: string): Token[] {
  let tokens = tokenCache.get(pattern)
  if (!tokens) {
    tokens = tokenize(pattern)
    if (tokenCache.size > 100) tokenCache.clear()
    tokenCache.set(pattern, tokens)
  }
  return tokens
}

/** Returns an error message for an unusable pattern, or null when it is fine. */
export function validateDateFormat(pattern: string): string | null {
  const trimmed = pattern.trim()
  if (!trimmed) return 'Enter a date format'
  if (trimmed.length > DATE_FORMAT_MAX_LENGTH) {
    return `Keep it under ${DATE_FORMAT_MAX_LENGTH} characters`
  }
  const hasPart = tokensFor(trimmed).some((t) => t.kind !== 'literal' && t.kind !== 'ampm')
  return hasPart ? null : 'Use at least one of d, m, yyyy, hh, mm or ss'
}

/** Format a date-like value; anything that isn't a date is returned unchanged. */
export function formatDateValue(v: unknown, pattern: string = DEFAULT_DATE_FORMAT): unknown {
  if (v === null || v === undefined) return v
  const parts = toDateParts(v)
  if (!parts) return v
  return render(parts, tokensFor(pattern))
}

/** Sample output for the job form preview (15 Mar 2024, 14:05:09). */
export function previewDateFormat(pattern: string): string {
  return render(
    { year: 2024, month: 3, day: 15, hour: 14, minute: 5, second: 9 },
    tokensFor(pattern.trim() || DEFAULT_DATE_FORMAT)
  )
}
