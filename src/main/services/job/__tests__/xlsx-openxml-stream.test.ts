import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ExcelJS from 'exceljs'
import {
  cellXml,
  colLetter,
  escapeXml,
  parseWorkbookSheets,
  rewriteXlsxPreservingOtherSheets
} from '../xlsx-openxml-stream'

describe('xlsx-openxml-stream helpers', () => {
  it('escapes XML special characters', () => {
    expect(escapeXml(`a<b>&"c"`)).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
  })

  it('maps column indexes to Excel letters', () => {
    expect(colLetter(0)).toBe('A')
    expect(colLetter(25)).toBe('Z')
    expect(colLetter(26)).toBe('AA')
    expect(colLetter(27)).toBe('AB')
  })

  it('encodes cells as inlineStr / numbers without shared strings', () => {
    expect(cellXml('A', 1, 'hello')).toContain('t="inlineStr"')
    expect(cellXml('B', 1, 42)).toBe('<c r="B1"><v>42</v></c>')
    expect(cellXml('C', 1, true)).toBe('<c r="C1" t="b"><v>1</v></c>')
    expect(cellXml('D', 1, null)).toBe('<c r="D1"/>')
  })

  it('parses workbook sheet map from workbook.xml + rels', () => {
    const workbookXml = `<?xml version="1.0"?>
      <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Data" sheetId="1" r:id="rId1"/>
          <sheet name="Report" sheetId="2" r:id="rId2"/>
        </sheets>
      </workbook>`
    const relsXml = `<?xml version="1.0"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      </Relationships>`
    const sheets = parseWorkbookSheets(workbookXml, relsXml)
    expect(sheets).toHaveLength(2)
    expect(sheets[0]).toMatchObject({
      name: 'Data',
      rId: 'rId1',
      targetPath: 'xl/worksheets/sheet1.xml'
    })
    expect(sheets[1].name).toBe('Report')
  })
})

describe('rewriteXlsxPreservingOtherSheets', () => {
  it('rewrites Data sheet while preserving a formula Report sheet', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bridge-openxml-'))
    const sourcePath = path.join(dir, 'template.xlsx')
    const destPath = path.join(dir, 'out.xlsx')

    const wb = new ExcelJS.Workbook()
    const data = wb.addWorksheet('Data')
    data.addRow(['old'])
    data.addRow([1])
    const report = wb.addWorksheet('Report')
    report.getCell('A1').value = { formula: 'SUM(Data!A:A)', result: 1 }
    report.getCell('B1').value = 'keep-me'
    await wb.xlsx.writeFile(sourcePath)

    await rewriteXlsxPreservingOtherSheets({
      sourcePath,
      destPath,
      isOwnedSheet: (name) => name === 'Data' || name.toLowerCase() === 'summary',
      sheets: [
        {
          name: 'Data',
          write: async (writeRow) => {
            await writeRow(['id', 'name'])
            await writeRow([1, 'alpha'])
            await writeRow([2, 'beta'])
          }
        },
        {
          name: 'Summary',
          write: async (writeRow) => {
            await writeRow(['Status', 'Rows'])
            await writeRow(['ok', 2])
          }
        }
      ]
    })

    const out = new ExcelJS.Workbook()
    await out.xlsx.readFile(destPath)

    const outData = out.getWorksheet('Data')
    expect(outData).toBeTruthy()
    expect(outData!.getRow(1).getCell(1).value).toBe('id')
    expect(outData!.getRow(2).getCell(2).value).toBe('alpha')
    expect(outData!.rowCount).toBeGreaterThanOrEqual(3)

    const outReport = out.getWorksheet('Report')
    expect(outReport).toBeTruthy()
    expect(outReport!.getCell('B1').value).toBe('keep-me')
    const a1 = outReport!.getCell('A1').value
    expect(a1).toBeTruthy()
    if (a1 && typeof a1 === 'object' && 'formula' in a1) {
      expect(String(a1.formula)).toMatch(/SUM\(Data!A:A\)/i)
    }

    expect(out.getWorksheet('Summary')).toBeTruthy()
    // Must not invent extra tabs — only Data rewrite + Summary (+ preserved Report).
    expect(out.worksheets.map((w) => w.name).sort()).toEqual(['Data', 'Report', 'Summary'].sort())

    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  it('rewrites existing Data in-place (same name) without creating Data_part1', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bridge-openxml-'))
    const filePath = path.join(dir, 'template.xlsx')

    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Data').addRow(['old-header'])
    wb.addWorksheet('Report').getCell('A1').value = 'formula-sheet'
    await wb.xlsx.writeFile(filePath)

    await rewriteXlsxPreservingOtherSheets({
      sourcePath: filePath,
      destPath: filePath,
      isOwnedSheet: (name) => name === 'Data',
      sheets: [
        {
          name: 'Data',
          write: async (writeRow) => {
            await writeRow(['a', 'b'])
            await writeRow([10, 20])
          }
        }
      ]
    })

    const out = new ExcelJS.Workbook()
    await out.xlsx.readFile(filePath)
    expect(out.getWorksheet('Data')).toBeTruthy()
    expect(out.getWorksheet('Data_part1')).toBeUndefined()
    expect(out.getWorksheet('Report')?.getCell('A1').value).toBe('formula-sheet')
    expect(out.getWorksheet('Data')!.getRow(1).getCell(1).value).toBe('a')

    await fs.promises.rm(dir, { recursive: true, force: true })
  })
})
