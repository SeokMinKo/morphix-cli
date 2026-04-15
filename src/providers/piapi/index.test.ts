import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPiapiProvider } from './index.js'

describe('piapi provider', () => {
  it('declares image, video, and music capabilities', () => {
    const provider = createPiapiProvider({ apiKey: 'test-key' })
    expect(provider.supports('image')).toBe(true)
    expect(provider.supports('video')).toBe(true)
    expect(provider.supports('music')).toBe(true)
  })

  it('does not declare unrelated capabilities', () => {
    const provider = createPiapiProvider({ apiKey: 'test-key' })
    expect(provider.supports('text')).toBe(false)
    expect(provider.supports('speech')).toBe(false)
    expect(provider.supports('vision')).toBe(false)
    expect(provider.supports('search')).toBe(false)
  })

  it('still declares capabilities when constructed with no credentials', () => {
    // supports() is a static declaration; network calls are deferred.
    const provider = createPiapiProvider({})
    expect(provider.supports('image')).toBe(true)
    expect(provider.supports('video')).toBe(true)
    expect(provider.supports('music')).toBe(true)
  })
})

describe('piapi video.poll status mapping', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockOnce(body: unknown) {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch
  }

  it('maps processing → running', async () => {
    mockOnce({ code: 200, data: { task_id: 't1', status: 'processing' } })
    const provider = createPiapiProvider({ apiKey: 'k' })
    const status = await provider.capabilities.video!.poll('t1')
    expect(status).toEqual({ jobId: 't1', state: 'running' })
  })

  it('maps completed → done', async () => {
    mockOnce({ code: 200, data: { task_id: 't1', status: 'completed' } })
    const provider = createPiapiProvider({ apiKey: 'k' })
    const status = await provider.capabilities.video!.poll('t1')
    expect(status).toEqual({ jobId: 't1', state: 'done' })
  })

  it('maps failed → error with message', async () => {
    mockOnce({
      code: 200,
      data: { task_id: 't1', status: 'failed', error: { message: 'upstream timeout' } },
    })
    const provider = createPiapiProvider({ apiKey: 'k' })
    const status = await provider.capabilities.video!.poll('t1')
    expect(status).toEqual({ jobId: 't1', state: 'error', error: 'upstream timeout' })
  })

  it('maps pending → pending', async () => {
    mockOnce({ code: 200, data: { task_id: 't1', status: 'pending' } })
    const provider = createPiapiProvider({ apiKey: 'k' })
    const status = await provider.capabilities.video!.poll('t1')
    expect(status).toEqual({ jobId: 't1', state: 'pending' })
  })
})

describe('piapi credentials', () => {
  it('throws E_NO_CREDENTIAL when invoking without apiKey', async () => {
    const provider = createPiapiProvider({})
    await expect(provider.capabilities.video!.poll('t1')).rejects.toMatchObject({
      code: 'E_NO_CREDENTIAL',
    })
  })
})
