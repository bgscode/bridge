/**
 * OpenXML surgical XLSX rewrite.
 *
 * Opens an existing .xlsx (ZIP), copies every entry untouched EXCEPT the
 * workbook metadata + owned worksheet parts, and streams replacement sheet
 * XML for those owned sheets. Formula sheets, charts, pivots, drawings,
 * styles, and sharedStrings of other sheets stay byte-identical on disk.
 *
 * Data cells use `t="inlineStr"` so we never touch `xl/sharedStrings.xml`
 * (which would otherwise force a full shared-string rebuild for millions
 * of values).
 */

import fs from 'fs'
import path from 'path'
import { PassThrough, once } from 'stream'
import { pipeline } from 'stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'

const WORKSHEET_CT =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
const WORKSHEET_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 0-based column index → Excel column letters (0→A, 25→Z, 26→AA). */
export function colLetter(index0: number): string {
  let n = index0 + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function cellXml(col: string, row: number, value: unknown): string {
  const ref = `${col}${row}`
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}"/>`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  }
  // Dates / everything else as inline string — avoids sharedStrings.xml.
  const text = escapeXml(String(value))
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
}

export interface WorkbookSheetRef {
  name: string
  sheetId: string
  rId: string
  /** ZIP path like xl/worksheets/sheet1.xml */
  targetPath: string
}

export function parseWorkbookSheets(
  workbookXml: string,
  relsXml: string
): WorkbookSheetRef[] {
  const ridToTarget = new Map<string, string>()
  const relRe =
    /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/gi
  let m: RegExpExecArray | null
  while ((m = relRe.exec(relsXml)) !== null) {
    const id = m[1]
    let target = m[2].replace(/\\/g, '/')
    // Target is relative to xl/
    if (target.startsWith('/')) target = target.slice(1)
    if (target.startsWith('xl/')) {
      // ok
    } else {
      target = `xl/${target}`
    }
    ridToTarget.set(id, target)
  }

  // Also match Target before Id (attribute order varies).
  const relRe2 =
    /<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"[^>]*\/?>/gi
  while ((m = relRe2.exec(relsXml)) !== null) {
    const id = m[2]
    if (ridToTarget.has(id)) continue
    let target = m[1].replace(/\\/g, '/')
    if (target.startsWith('/')) target = target.slice(1)
    if (!target.startsWith('xl/')) target = `xl/${target}`
    ridToTarget.set(id, target)
  }

  const sheets: WorkbookSheetRef[] = []
  const sheetRe =
    /<sheet\b[^>]*\bname="([^"]+)"[^>]*\bsheetId="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/?>/gi
  while ((m = sheetRe.exec(workbookXml)) !== null) {
    const name = decodeXmlEntities(m[1])
    const sheetId = m[2]
    const rId = m[3]
    const targetPath = ridToTarget.get(rId)
    if (!targetPath) continue
    sheets.push({ name, sheetId, rId, targetPath })
  }

  // Alternate attribute order: r:id before name, etc.
  if (sheets.length === 0) {
    const sheetReAlt =
      /<sheet\b([^>]+?)\/?>/gi
    while ((m = sheetReAlt.exec(workbookXml)) !== null) {
      const attrs = m[1]
      const nameM = /\bname="([^"]+)"/i.exec(attrs)
      const idM = /\bsheetId="([^"]+)"/i.exec(attrs)
      const ridM = /\br:id="([^"]+)"/i.exec(attrs)
      if (!nameM || !idM || !ridM) continue
      const targetPath = ridToTarget.get(ridM[1])
      if (!targetPath) continue
      sheets.push({
        name: decodeXmlEntities(nameM[1]),
        sheetId: idM[1],
        rId: ridM[1],
        targetPath
      })
    }
  }

  return sheets
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export interface OpenXmlSheetSpec {
  name: string
  /** Stream rows (header included as first writeRow). Must not hold all rows. */
  write: (writeRow: (cells: unknown[]) => Promise<void>) => Promise<void>
}

export interface RewriteXlsxOptions {
  sourcePath: string
  /** Final destination. Written atomically via a sibling temp file. */
  destPath: string
  /** True for sheets this job owns and will replace (Data, Summary, buckets…). */
  isOwnedSheet: (sheetName: string) => boolean
  sheets: OpenXmlSheetSpec[]
}

interface ZipEntryMeta {
  fileName: string
  uncompressedSize: number
}

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error('Failed to open xlsx ZIP'))
      else resolve(zip)
    })
  })
}

function readEntryBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error(`Cannot read ZIP entry ${entry.fileName}`))
        return
      }
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks)))
    })
  })
}

function listZipEntries(filePath: string): Promise<Map<string, ZipEntryMeta>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error('Failed to open xlsx'))
        return
      }
      const map = new Map<string, ZipEntryMeta>()
      zip.readEntry()
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!/\/$/.test(entry.fileName)) {
          map.set(entry.fileName.replace(/\\/g, '/'), {
            fileName: entry.fileName.replace(/\\/g, '/'),
            uncompressedSize: entry.uncompressedSize
          })
        }
        zip.readEntry()
      })
      zip.on('end', () => resolve(map))
      zip.on('error', reject)
    })
  })
}

async function readZipText(filePath: string, entryName: string): Promise<string | null> {
  const zip = await openZip(filePath)
  return new Promise((resolve, reject) => {
    let found = false
    zip.readEntry()
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName.replace(/\\/g, '/')
      if (name !== entryName) {
        zip.readEntry()
        return
      }
      found = true
      void readEntryBuffer(zip, entry)
        .then((buf) => resolve(buf.toString('utf-8')))
        .catch(reject)
    })
    zip.on('end', () => {
      if (!found) resolve(null)
    })
    zip.on('error', reject)
  })
}

function nextSheetFileName(usedTargets: Set<string>): string {
  let n = 1
  for (;;) {
    const candidate = `xl/worksheets/sheet${n}.xml`
    if (!usedTargets.has(candidate)) return candidate
    n++
    if (n > 100_000) throw new Error('Exhausted worksheet part names')
  }
}

function nextRId(used: Set<string>): string {
  let n = 1
  for (;;) {
    const id = `rId${n}`
    if (!used.has(id)) return id
    n++
    if (n > 100_000) throw new Error('Exhausted relationship ids')
  }
}

function nextSheetId(used: Set<string>): string {
  let n = 1
  for (;;) {
    const id = String(n)
    if (!used.has(id)) return id
    n++
    if (n > 100_000) throw new Error('Exhausted sheet ids')
  }
}

function rebuildWorkbookXml(
  original: string,
  kept: WorkbookSheetRef[],
  added: WorkbookSheetRef[]
): string {
  const all = [...kept, ...added]
  const sheetsXml =
    `<sheets>` +
    all
      .map(
        (s) =>
          `<sheet name="${escapeXml(s.name)}" sheetId="${s.sheetId}" r:id="${s.rId}"/>`
      )
      .join('') +
    `</sheets>`

  if (/<sheets\b[^>]*>[\s\S]*?<\/sheets>/i.test(original)) {
    return original.replace(/<sheets\b[^>]*>[\s\S]*?<\/sheets>/i, sheetsXml)
  }
  // Fallback: inject before </workbook>
  return original.replace(/<\/workbook>/i, `${sheetsXml}</workbook>`)
}

function rebuildWorkbookRels(original: string, sheets: WorkbookSheetRef[]): string {
  // Drop existing worksheet relationships; keep themes/styles/sharedStrings/etc.
  let rels = original.replace(
    /<Relationship\b[^>]*Type="[^"]*\/worksheet"[^>]*\/?>\s*/gi,
    ''
  )

  const sheetRels = sheets
    .map((s) => {
      const target = s.targetPath.replace(/^xl\//, '')
      return `<Relationship Id="${s.rId}" Type="${WORKSHEET_REL_TYPE}" Target="${target}"/>`
    })
    .join('')

  if (/<\/Relationships>/i.test(rels)) {
    rels = rels.replace(/<\/Relationships>/i, `${sheetRels}</Relationships>`)
  } else {
    rels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `${sheetRels}</Relationships>`
  }
  return rels
}

function rebuildContentTypes(
  original: string,
  sheetPaths: string[]
): string {
  // Remove existing worksheet Override entries, then add ours.
  let ct = original.replace(
    /<Override\b[^>]*PartName="\/xl\/worksheets\/[^"]+"[^>]*\/>\s*/gi,
    ''
  )
  const overrides = sheetPaths
    .map(
      (p) =>
        `<Override PartName="/${p}" ContentType="${WORKSHEET_CT}"/>`
    )
    .join('')
  if (/<\/Types>/i.test(ct)) {
    ct = ct.replace(/<\/Types>/i, `${overrides}</Types>`)
  }
  return ct
}

/**
 * Create a PassThrough that emits a complete worksheet XML document as rows
 * are written. Caller must `await end()` when done.
 */
export function createWorksheetXmlStream(): {
  stream: PassThrough
  writeRow: (cells: unknown[]) => Promise<void>
  end: () => Promise<void>
} {
  const stream = new PassThrough({ highWaterMark: 512 * 1024 })
  let rowNum = 0
  let ended = false
  let buffer = ''
  const FLUSH_AT = 64 * 1024

  const prologue =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetData>`
  stream.write(prologue)

  async function flush(): Promise<void> {
    if (!buffer) return
    const chunk = buffer
    buffer = ''
    if (!stream.write(chunk)) {
      await once(stream, 'drain')
    }
  }

  async function writeRow(cells: unknown[]): Promise<void> {
    if (ended) throw new Error('Worksheet stream already ended')
    rowNum++
    let xml = `<row r="${rowNum}">`
    for (let i = 0; i < cells.length; i++) {
      xml += cellXml(colLetter(i), rowNum, cells[i])
    }
    xml += `</row>`
    buffer += xml
    if (buffer.length >= FLUSH_AT) await flush()
  }

  async function end(): Promise<void> {
    if (ended) return
    ended = true
    buffer += `</sheetData></worksheet>`
    await flush()
    stream.end()
  }

  return { stream, writeRow, end }
}

/**
 * Surgically rewrite owned sheets inside an existing .xlsx while copying
 * every other ZIP entry (charts, pivots, formulas, drawings, styles…)
 * untouched. Returns the destPath on success.
 */
export async function rewriteXlsxPreservingOtherSheets(
  options: RewriteXlsxOptions
): Promise<string> {
  const { sourcePath, destPath, isOwnedSheet, sheets } = options
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`OpenXML rewrite: source not found: ${sourcePath}`)
  }
  if (sheets.length === 0) {
    throw new Error('OpenXML rewrite: no sheets to write')
  }

  const workbookXml = await readZipText(sourcePath, 'xl/workbook.xml')
  const relsXml = await readZipText(sourcePath, 'xl/_rels/workbook.xml.rels')
  const contentTypesXml = await readZipText(sourcePath, '[Content_Types].xml')
  if (!workbookXml || !relsXml || !contentTypesXml) {
    throw new Error('OpenXML rewrite: workbook is missing required package parts')
  }

  const existingSheets = parseWorkbookSheets(workbookXml, relsXml)
  const kept = existingSheets.filter((s) => !isOwnedSheet(s.name))
  const ownedTargets = new Set(
    existingSheets.filter((s) => isOwnedSheet(s.name)).map((s) => s.targetPath)
  )

  const usedTargets = new Set(kept.map((s) => s.targetPath))
  const usedRIds = new Set(kept.map((s) => s.rId))
  // Preserve non-worksheet rIds from original rels so we don't collide.
  {
    const relIdRe = /\bId="(rId\d+)"/gi
    let m: RegExpExecArray | null
    while ((m = relIdRe.exec(relsXml)) !== null) usedRIds.add(m[1])
  }
  const usedSheetIds = new Set(kept.map((s) => s.sheetId))

  // Match by sheet NAME so "Data" rewrites the existing Data part in-place
  // (same sheet1.xml / rId / sheetId) instead of allocating a brand-new sheet.
  const ownedByName = new Map<string, WorkbookSheetRef>()
  for (const s of existingSheets) {
    if (isOwnedSheet(s.name)) ownedByName.set(s.name.toLowerCase(), s)
  }
  const reusableTargets = existingSheets
    .filter((s) => isOwnedSheet(s.name))
    .map((s) => s.targetPath)

  const added: WorkbookSheetRef[] = []
  const claimedTargets = new Set<string>()
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].name
    const existing = ownedByName.get(name.toLowerCase())

    let targetPath: string
    let rId: string
    let sheetId: string

    if (existing && !claimedTargets.has(existing.targetPath)) {
      // In-place rewrite of the same worksheet part the template already had.
      targetPath = existing.targetPath
      rId = existing.rId
      sheetId = existing.sheetId
      claimedTargets.add(targetPath)
      usedTargets.add(targetPath)
      usedRIds.add(rId)
      usedSheetIds.add(sheetId)
    } else {
      // Overflow parts (Data_part2…) or brand-new owned sheets.
      const reusable = reusableTargets.find((t) => !usedTargets.has(t) && !claimedTargets.has(t))
      targetPath = reusable ?? nextSheetFileName(usedTargets)
      usedTargets.add(targetPath)
      claimedTargets.add(targetPath)
      ownedTargets.add(targetPath)
      rId = nextRId(usedRIds)
      usedRIds.add(rId)
      sheetId = nextSheetId(usedSheetIds)
      usedSheetIds.add(sheetId)
    }

    ownedTargets.add(targetPath)
    added.push({ name, sheetId, rId, targetPath })
  }

  const newWorkbookXml = rebuildWorkbookXml(workbookXml, kept, added)
  const allSheetRefs = [...kept, ...added]
  const newRelsXml = rebuildWorkbookRels(relsXml, allSheetRefs)
  const newContentTypes = rebuildContentTypes(
    contentTypesXml,
    allSheetRefs.map((s) => s.targetPath)
  )

  const skipExact = new Set<string>([
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    '[Content_Types].xml',
    ...ownedTargets
  ])

  const tmpPath = `${destPath}.openxml-tmp-${process.pid}-${Date.now()}.xlsx`
  const outZip = new yazl.ZipFile()
  const entryMeta = await listZipEntries(sourcePath)

  // Pipe output ZIP to temp file.
  const writeDone = pipeline(outZip.outputStream, fs.createWriteStream(tmpPath))

  // 1) Copy untouched entries from source.
  await new Promise<void>((resolve, reject) => {
    yauzl.open(sourcePath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error('Failed to reopen xlsx for copy'))
        return
      }

      const copyNext = (): void => {
        zip.readEntry()
      }

      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.replace(/\\/g, '/')
        if (/\/$/.test(name) || skipExact.has(name)) {
          copyNext()
          return
        }
        zip.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            reject(streamErr ?? new Error(`Cannot stream ${name}`))
            return
          }
          outZip.addReadStream(readStream, name, {
            compress: true,
            size: entryMeta.get(name)?.uncompressedSize
          })
          readStream.on('end', () => copyNext())
          readStream.on('error', reject)
        })
      })
      zip.on('end', () => resolve())
      zip.on('error', reject)
      copyNext()
    })
  })

  // 2) Metadata parts (small).
  outZip.addBuffer(Buffer.from(newContentTypes, 'utf-8'), '[Content_Types].xml')
  outZip.addBuffer(Buffer.from(newWorkbookXml, 'utf-8'), 'xl/workbook.xml')
  outZip.addBuffer(Buffer.from(newRelsXml, 'utf-8'), 'xl/_rels/workbook.xml.rels')

  // 3) Stream each owned sheet XML.
  for (let i = 0; i < sheets.length; i++) {
    const spec = sheets[i]
    const ref = added[i]
    const { stream, writeRow, end } = createWorksheetXmlStream()
    outZip.addReadStream(stream, ref.targetPath, { compress: true })
    await spec.write(writeRow)
    await end()
  }

  outZip.end()
  await writeDone

  // Atomic replace into destPath.
  const destDir = path.dirname(destPath)
  await fs.promises.mkdir(destDir, { recursive: true })
  if (fs.existsSync(destPath)) {
    await fs.promises.unlink(destPath)
  }
  await fs.promises.rename(tmpPath, destPath)
  return destPath
}
