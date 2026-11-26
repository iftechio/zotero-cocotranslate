// Names of translated files. The backend names results `<original stem>-dual.pdf` / `-mono.pdf`
// and puts that name on the signed download URL.

import type { Mode } from '../api/pdf.ts'

/** Same rule as the backend, for when the download carries no name. */
export function resultFilename(original: string, mode: Mode): string {
  const base = original.replace(/\.pdf$/i, '').trim()
  return base === '' ? `${mode}.pdf` : `${base}-${mode}.pdf`
}

/** The file name in a Content-Disposition value, preferring RFC 5987 `filename*`. */
export function filenameFromDisposition(value: string | null | undefined): string | null {
  if (!value) return null
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(value)
  if (extended?.[2]) {
    try {
      return decodeURIComponent(extended[2].trim().replace(/^"|"$/g, ''))
    } catch {
      // fall through to the plain parameter
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(value)
  const name = plain?.[2] ?? plain?.[1]
  return name ? name.trim() : null
}

/** The name an OSS / S3 signed URL asks the browser to save as (`response-content-disposition`). */
export function filenameFromSignedURL(url: string): string | null {
  try {
    const u = new URL(url)
    return filenameFromDisposition(u.searchParams.get('response-content-disposition'))
  } catch {
    return null
  }
}

/** Drops path separators and control characters; Zotero cleans the rest. */
export function safeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[/\\\u0000-\u001f]/g, '_').trim()
  return cleaned === '' ? 'translation.pdf' : cleaned
}
