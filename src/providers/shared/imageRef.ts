import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ImageRef } from '../../capabilities/types.js'

/**
 * Normalize an ImageRef (path | url | bytes) into raw bytes + MIME. URL refs
 * are fetched (provider adapters might prefer to pass the URL directly when
 * the backend supports it, but this helper is here for adapters that need
 * base64 bytes).
 */
export async function readImageRef(ref: ImageRef): Promise<{ bytes: Uint8Array; mime: string }> {
  if (ref.kind === 'bytes') {
    return { bytes: ref.bytes, mime: ref.mime }
  }
  if (ref.kind === 'path') {
    const bytes = await readFile(ref.path)
    return { bytes, mime: mimeFromExt(ref.path) }
  }
  // URL
  const res = await fetch(ref.url)
  if (!res.ok) {
    throw new Error(`Failed to fetch image: HTTP ${res.status}`)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  const mime = res.headers.get('content-type') ?? mimeFromExt(ref.url)
  return { bytes: buf, mime }
}

export function mimeFromExt(path: string): string {
  const ext = extname(path).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}
