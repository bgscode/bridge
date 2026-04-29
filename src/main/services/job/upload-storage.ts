import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

function getUploadBaseDir(): string {
  return path.join(os.tmpdir(), 'bridge-uploads')
}

export function isStagedUploadPath(filePath: string): boolean {
  const base = path.resolve(getUploadBaseDir()) + path.sep
  const target = path.resolve(filePath)
  return target.startsWith(base)
}

export async function stageFile(
  jobId: number | null,
  srcPath: string
): Promise<{
  uploadId: string
  stagedPath: string
  filename: string
}> {
  const base = getUploadBaseDir()
  const uploadId = crypto.randomBytes(8).toString('hex')
  const dirName = jobId ? `job-${jobId}-${uploadId}` : `upload-${uploadId}`
  const destDir = path.join(base, dirName)
  await fs.promises.mkdir(destDir, { recursive: true })

  const filename = path.basename(srcPath)
  const destPath = path.join(destDir, filename)

  // Use copyFile to preserve original; overwrite if exists
  await fs.promises.copyFile(srcPath, destPath)

  return { uploadId, stagedPath: destPath, filename }
}

export async function stageBuffer(
  jobId: number | null,
  filename: string,
  data: Buffer
): Promise<{ uploadId: string; stagedPath: string; filename: string }> {
  const base = getUploadBaseDir()
  const uploadId = crypto.randomBytes(8).toString('hex')
  const dirName = jobId ? `job-${jobId}-${uploadId}` : `upload-${uploadId}`
  const destDir = path.join(base, dirName)
  await fs.promises.mkdir(destDir, { recursive: true })

  const destPath = path.join(destDir, filename)
  await fs.promises.writeFile(destPath, data)

  return { uploadId, stagedPath: destPath, filename }
}

export async function cleanupUploadDir(stagedPath: string): Promise<void> {
  if (!isStagedUploadPath(stagedPath)) {
    throw new Error('Invalid staged file path')
  }

  try {
    const dir = path.dirname(stagedPath)
    if (fs.existsSync(dir)) {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  } catch {
    // best effort
  }
}
