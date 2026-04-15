import { describe, expect, it } from 'vitest'
import { iterSse, iterNdjson, iterLines } from './sse.js'

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(s))
      controller.close()
    },
  })
}

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[i++]))
    },
  })
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of iter) out.push(v)
  return out
}

describe('iterLines', () => {
  it('splits on LF', async () => {
    const lines = await collect(iterLines(streamFromString('a\nb\nc')))
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('handles CRLF', async () => {
    const lines = await collect(iterLines(streamFromString('a\r\nb\r\n')))
    expect(lines).toEqual(['a', 'b'])
  })

  it('handles split chunks', async () => {
    const lines = await collect(iterLines(chunkedStream(['hel', 'lo\nwo', 'rld\n'])))
    expect(lines).toEqual(['hello', 'world'])
  })
})

describe('iterSse', () => {
  it('parses single event with data', async () => {
    const events = await collect(iterSse(streamFromString('data: hello\n\n')))
    expect(events).toEqual([{ event: undefined, data: 'hello', id: undefined }])
  })

  it('parses typed events', async () => {
    const body = `event: message\ndata: {"x":1}\n\nevent: done\ndata: {}\n\n`
    const events = await collect(iterSse(streamFromString(body)))
    expect(events.length).toBe(2)
    expect(events[0].event).toBe('message')
    expect(JSON.parse(events[0].data)).toEqual({ x: 1 })
    expect(events[1].event).toBe('done')
  })

  it('supports multi-line data', async () => {
    const body = `data: line1\ndata: line2\n\n`
    const [ev] = await collect(iterSse(streamFromString(body)))
    expect(ev.data).toBe('line1\nline2')
  })

  it('ignores comment lines', async () => {
    const body = `: keep-alive\ndata: ok\n\n`
    const [ev] = await collect(iterSse(streamFromString(body)))
    expect(ev.data).toBe('ok')
  })
})

describe('iterNdjson', () => {
  it('parses JSON lines', async () => {
    const body = `{"a":1}\n{"a":2}\n{"a":3}\n`
    const out = await collect(iterNdjson<{ a: number }>(streamFromString(body)))
    expect(out.map((o) => o.a)).toEqual([1, 2, 3])
  })

  it('skips empty and unparseable lines', async () => {
    const body = `{"a":1}\n\nnot json\n{"a":2}\n`
    const out = await collect(iterNdjson<{ a: number }>(streamFromString(body)))
    expect(out.map((o) => o.a)).toEqual([1, 2])
  })
})
