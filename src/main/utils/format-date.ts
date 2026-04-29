/**
 * Format a UTC timestamp string (from SQLite / ISO) to IST (+05:30) display.
 * Matches the renderer-side formatter in src/renderer/src/lib/utils.ts.
 */
export function formatUtcToIst(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  // Accept both "YYYY-MM-DD HH:MM:SS" and "YYYY-MM-DDTHH:MM:SS(.sss)(Z)".
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return raw

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6])

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second)
  const istMs = utcMs + (5 * 60 + 30) * 60 * 1000
  const d = new Date(istMs)

  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  const h24 = d.getUTCHours()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const hh = String(h12).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  const ampm = h24 >= 12 ? 'PM' : 'AM'

  return `${y}-${mo}-${da} ${hh}:${mm}:${ss} ${ampm}`
}
