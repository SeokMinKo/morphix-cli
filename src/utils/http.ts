import { ProviderHttpError } from './errors.js'

export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH'
  headers?: Record<string, string>
  /** Serialized as JSON body if present. */
  json?: unknown
  /** Raw body (string/Uint8Array) overrides `json`. */
  body?: string | Uint8Array
  signal?: AbortSignal
  /** Provider name, used for error context. */
  provider: string
}

/**
 * Issue an HTTP request, throw ProviderHttpError on non-2xx. Returns the raw
 * Response so callers can choose between .json(), .text(), or .body (stream).
 */
export async function httpRequest(req: HttpRequest): Promise<Response> {
  const headers: Record<string, string> = { ...(req.headers ?? {}) }
  let body: BodyInit | undefined
  if (req.json !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json'
    body = JSON.stringify(req.json)
  } else if (typeof req.body === 'string') {
    body = req.body
  } else if (req.body !== undefined) {
    // Uint8Array → copy into an ArrayBuffer-backed view that fetch accepts.
    body = new Uint8Array(req.body)
  }

  const res = await fetch(req.url, {
    method: req.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    signal: req.signal,
  })

  if (!res.ok) {
    let text: string | undefined
    try {
      text = await res.text()
    } catch {
      // ignore
    }
    throw new ProviderHttpError(req.provider, res.status, text)
  }
  return res
}

/** JSON convenience wrapper. */
export async function httpJson<T = unknown>(req: HttpRequest): Promise<T> {
  const res = await httpRequest(req)
  return (await res.json()) as T
}
