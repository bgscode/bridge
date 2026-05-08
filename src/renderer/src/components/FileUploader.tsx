import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type JSX } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { CheckCircle2, ExternalLink, FileIcon, Loader2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { getToken } from '@/lib/api'

type PresignedUploadResponse = {
  url: string
  fields: Record<string, string>
}

function policyRequiresAclPublicRead(policyBase64?: string): boolean {
  if (!policyBase64) return false
  try {
    const decoded = atob(policyBase64)
    const parsed = JSON.parse(decoded) as {
      conditions?: Array<Record<string, unknown> | unknown[]>
    }
    const conditions = parsed.conditions ?? []
    for (const c of conditions) {
      if (Array.isArray(c)) {
        // Example: ["eq", "$acl", "public-read"]
        if (
          String(c[0] ?? '').toLowerCase() === 'eq' &&
          String(c[1] ?? '').toLowerCase() === '$acl' &&
          String(c[2] ?? '').toLowerCase() === 'public-read'
        ) {
          return true
        }
      } else if (c && typeof c === 'object') {
        // Example: {"acl":"public-read"}
        const acl = (c as Record<string, unknown>).acl
        if (typeof acl === 'string' && acl.toLowerCase() === 'public-read') {
          return true
        }
      }
    }
  } catch {
    // Ignore parse issues; best-effort detection only.
  }
  return false
}

type FileUploaderProps = {
  destination: string
  onUploadComplete: (url: string) => void
  accept?: string
  maxSizeMB?: number
  /** Pre-existing URL (e.g. when editing a saved job). Shows filename + link. */
  initialUrl?: string | null
}

function getApiBaseUrl(): string {
  const env = import.meta.env as ImportMetaEnv & Record<string, string | undefined>
  return (
    env.BRIDGE_API_URL ??
    env.VITE_BRIDGE_API_URL ??
    (import.meta.env.DEV ? 'http://localhost:4000/api' : 'https://link.yonolight.com/api')
  ).replace(/\/$/, '')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function buildPublicFileUrl(presigned: PresignedUploadResponse): string {
  return `${presigned.url}${presigned.fields.key}`
}

export function FileUploader({
  destination,
  onUploadComplete,
  accept = '*/*',
  maxSizeMB = 100,
  initialUrl = null
}: FileUploaderProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      xhrRef.current?.abort()
    }
  }, [])

  function validateFile(file: File): string | null {
    const maxBytes = maxSizeMB * 1024 * 1024
    if (file.size > maxBytes) {
      return `File is too large. Maximum allowed size is ${maxSizeMB} MB.`
    }
    return null
  }

  function resetForNewFile(file: File): void {
    setSelectedFile(file)
    setUploadedUrl(null)
    setProgress(0)
    setError(null)
  }

  function handleIncomingFile(file: File | null): void {
    if (!file) return
    const validationError = validateFile(file)
    if (validationError) {
      setSelectedFile(null)
      setUploadedUrl(null)
      setProgress(0)
      setError(validationError)
      return
    }
    resetForNewFile(file)
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>): void {
    handleIncomingFile(event.target.files?.[0] ?? null)
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setIsDragging(false)
    handleIncomingFile(event.dataTransfer.files?.[0] ?? null)
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    if (!isUploading) setIsDragging(true)
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsDragging(false)
  }

  async function getPresignedUrl(file: File): Promise<PresignedUploadResponse> {
    const token = getToken()
    if (!token) {
      throw new Error('You must be logged in to upload files.')
    }

    const response = await fetch(`${getApiBaseUrl()}/upload/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        destination,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream'
      })
    })

    if (!response.ok) {
      let message = `Failed to prepare upload (HTTP ${response.status}).`
      try {
        const data = (await response.json()) as { message?: string; error?: string }
        message = data.message ?? data.error ?? message
      } catch {
        // fall back to default message
      }
      throw new Error(message)
    }

    return (await response.json()) as PresignedUploadResponse
  }

  function uploadToS3(file: File, presigned: PresignedUploadResponse): Promise<string> {
    const requiresAclPublicRead = policyRequiresAclPublicRead(presigned.fields.Policy)

    function extractS3Error(xml: string): string {
      const code = xml.match(/<Code>([^<]+)<\/Code>/i)?.[1]
      const msg = xml.match(/<Message>([^<]+)<\/Message>/i)?.[1]
      if (code || msg) return `${code ?? 'S3Error'}: ${msg ?? 'Upload failed'}`
      return 'Upload failed.'
    }

    function attemptUpload(mode: 'as-is' | 'omit-acl' | 'force-acl'): Promise<void> {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrRef.current = xhr

        xhr.open('POST', presigned.url)

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          setProgress(Math.round((event.loaded / event.total) * 100))
        }

        xhr.onerror = () => {
          reject(new Error('Upload failed. Please try again.'))
        }

        xhr.onabort = () => {
          reject(new Error('Upload was cancelled.'))
        }

        xhr.onload = () => {
          if (xhr.status === 204) {
            resolve()
            return
          }
          reject(new Error(extractS3Error(xhr.responseText || '')))
        }

        const formData = new FormData()
        for (const [key, value] of Object.entries(presigned.fields)) {
          if (
            mode === 'omit-acl' &&
            (key.toLowerCase() === 'acl' || key.toLowerCase() === 'x-amz-acl')
          ) {
            continue
          }
          formData.append(key, value)
        }

        if (mode === 'force-acl') {
          const aclFromFields =
            presigned.fields.acl ?? presigned.fields['x-amz-acl'] ?? 'public-read'
          // Some presigned policies explicitly require "$acl" (not x-amz-acl).
          formData.append('acl', aclFromFields)
        }

        formData.append('file', file)
        xhr.send(formData)
      })
    }

    return (async () => {
      try {
        // First try exactly what backend presigned policy asked for.
        await attemptUpload('as-is')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed.'

        // Policy explicitly asked for $acl field; retry once with forced acl.
        if (/Policy Condition failed.*\$acl/i.test(message)) {
          await attemptUpload('force-acl')
          return buildPublicFileUrl(presigned)
        }

        // Bucket has ACLs disabled. Retry without ACL only when the policy
        // does NOT require acl=public-read. If policy requires ACL, this is a
        // backend misconfiguration and cannot be fixed on client.
        if (!/AccessControlListNotSupported/i.test(message)) throw err
        if (requiresAclPublicRead) {
          throw new Error(
            'Upload configuration mismatch: presigned policy requires acl=public-read but S3 bucket has ACLs disabled. Please fix backend presign generation (remove ACL conditions/fields) or enable ACL-compatible bucket mode.'
          )
        }
        await attemptUpload('omit-acl')
      }
      return buildPublicFileUrl(presigned)
    })()
  }

  async function handleUpload(): Promise<void> {
    if (!selectedFile || isUploading) return

    setIsUploading(true)
    setError(null)
    setUploadedUrl(null)
    setProgress(0)

    try {
      const presigned = await getPresignedUrl(selectedFile)
      const finalUrl = await uploadToS3(selectedFile, presigned)
      setUploadedUrl(finalUrl)
      setProgress(100)
      toast.success('File uploaded successfully.')
      onUploadComplete(finalUrl)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.'
      setError(message)
      toast.error(message)
    } finally {
      setIsUploading(false)
      xhrRef.current = null
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onInputChange}
        disabled={isUploading}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => !isUploading && inputRef.current?.click()}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !isUploading) {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'rounded-xl border border-dashed p-5 transition-colors outline-none',
          'bg-muted/20 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isDragging && 'border-primary bg-primary/5',
          isUploading && 'pointer-events-none opacity-70',
          error && 'border-destructive/60'
        )}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-lg border bg-background p-2">
            <UploadCloud className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">Drop a file here or click to browse</p>
              <Badge variant="secondary">Max {maxSizeMB} MB</Badge>
              {uploadedUrl && (
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                  <CheckCircle2 className="mr-1 size-3.5" />
                  Uploaded
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Accepted: {accept}</p>

            {selectedFile ? (
              <div className="mt-3 rounded-lg border bg-background/80 px-3 py-2 text-sm">
                <p className="truncate font-medium" title={selectedFile.name}>
                  {selectedFile.name}
                </p>
                <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
              </div>
            ) : initialUrl ? (
              <div className="mt-3 rounded-lg border bg-background/80 px-3 py-2 text-sm flex items-center gap-2">
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-xs" title={initialUrl}>
                    {initialUrl.split('/').pop() ?? initialUrl}
                  </p>
                  <a
                    href={initialUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="size-3" />
                    Open file
                  </a>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No file selected yet.</p>
            )}
          </div>
        </div>
      </div>

      {isUploading || progress > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{isUploading ? 'Uploading...' : 'Upload complete'}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
        >
          Choose File
        </Button>
        <Button
          type="button"
          onClick={() => void handleUpload()}
          disabled={!selectedFile || isUploading}
        >
          {isUploading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {isUploading ? 'Uploading' : 'Upload File'}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {uploadedUrl ? (
        <p className="text-xs text-muted-foreground break-all">
          Uploaded URL: <span className="font-mono">{uploadedUrl}</span>
        </p>
      ) : null}
    </div>
  )
}
