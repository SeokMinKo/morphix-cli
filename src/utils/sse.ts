/**
 * Tiny stream decoders used by provider adapters. Keeps us dependency-free.
 *
 *  - iterLines: chunk a byte stream into text lines
 *  - iterSse:   parse a Server-Sent Events stream into typed {event, data} records
 *  - iterNdjson: parse an NDJSON (newline-delimited JSON) stream into objects
 */

export interface SseEvent {
  event?: string
  data: string
  id?: string
}

export async function* iterLines(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<string> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        // Strip a trailing \r so we correctly handle CRLF line endings too.
        yield line.endsWith('\r') ? line.slice(0, -1) : line
      }
    }
    if (buffer.length > 0) yield buffer
  } finally {
    reader.releaseLock()
  }
}

/**
 * Parse a text/event-stream body into SSE events. Handles multi-line `data:`
 * fields and ignores comments (lines starting with `:`).
 */
export async function* iterSse(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<SseEvent> {
  let event: string | undefined
  let data: string[] = []
  let id: string | undefined

  for await (const rawLine of iterLines(body)) {
    const line = rawLine
    if (line === '') {
      if (data.length > 0 || event !== undefined) {
        yield { event, data: data.join('\n'), id }
      }
      event = undefined
      data = []
      id = undefined
      continue
    }
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon >= 0 ? line.slice(0, colon) : line
    let value = colon >= 0 ? line.slice(colon + 1) : ''
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    else if (field === 'id') id = value
  }
  if (data.length > 0 || event !== undefined) {
    yield { event, data: data.join('\n'), id }
  }
}

/** Parse an NDJSON body (one JSON value per line). Empty lines are skipped. */
export async function* iterNdjson<T = unknown>(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<T> {
  for await (const line of iterLines(body)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      yield JSON.parse(trimmed) as T
    } catch {
      // Skip unparseable lines rather than abort the stream.
    }
  }
}
