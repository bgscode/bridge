import { describe, expect, it } from 'vitest'
import { __testing } from '../gsheet-writer'

describe('gsheet-writer helpers', () => {
  it('deduplicates bucket tabs and avoids reserved tab names', () => {
    const targets = __testing.buildGoogleSheetBucketTargets(
      [
        { label: 'Data', columns: [], error: null, chunkFiles: [] },
        { label: 'Store A', columns: [], error: null, chunkFiles: [] },
        { label: 'Store A', columns: [], error: null, chunkFiles: [] }
      ],
      ['Data', 'Summary']
    )

    expect(targets.map((target) => target.tabName)).toEqual(['Data_2', 'Store A', 'Store A_2'])
  })

  it('parses service-account credentials wrapped in double braces', () => {
    const credentials = __testing.loadServiceAccountCredentials({
      credentials: `{{
        "client_email": "svc@example.com",
        "private_key": "line1\\nline2"
      }}`
    })

    expect(credentials).toEqual({
      client_email: 'svc@example.com',
      private_key: 'line1\nline2'
    })
  })

  it('removes sparse holes and trailing empty columns', () => {
    const row = new Array(48) as unknown[]
    row[0] = 'alpha'
    row[2] = 'charlie'

    expect(__testing.sanitizeArrayRow(row)).toEqual(['alpha', '', 'charlie'])
  })

  it('trims trailing empty header slots introduced by sparse arrays', () => {
    const headers = new Array(48) as string[]
    headers[0] = 'id'
    headers[1] = 'name'
    headers[2] = 'status'

    expect(__testing.sanitizeHeaderRow(headers)).toEqual(['id', 'name', 'status'])
  })

  it('builds an explicit quoted target range for chunk writes', () => {
    expect(__testing.buildTargetRange("Bob's Sheet", 3, 2, 48)).toBe("'Bob''s Sheet'!A3:AV4")
  })
})
