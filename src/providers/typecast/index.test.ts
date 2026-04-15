import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTypecastProvider } from './index.js'

describe('typecast provider', () => {
  it('declares only the speech capability', () => {
    const provider = createTypecastProvider({ apiKey: 'test-key' })
    expect(provider.supports('speech')).toBe(true)
    expect(provider.supports('text')).toBe(false)
    expect(provider.supports('image')).toBe(false)
    expect(provider.supports('video')).toBe(false)
    expect(provider.supports('music')).toBe(false)
    expect(provider.supports('vision')).toBe(false)
    expect(provider.supports('search')).toBe(false)
  })

  it('still declares speech when constructed with no credentials', () => {
    const provider = createTypecastProvider({})
    expect(provider.supports('speech')).toBe(true)
  })
})

describe('typecast synthesize', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends Authorization: Bearer header and polls speak_v2_url until done', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push({ url, init })
      if (url.endsWith('/api/speak')) {
        return new Response(
          JSON.stringify({ result: { speak_v2_url: 'https://typecast.ai/api/speak/status/abc' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/speak/status/abc')) {
        return new Response(
          JSON.stringify({
            result: { status: 'done', audio_download_url: 'https://cdn.typecast.ai/out.mp3' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/out.mp3')) {
        return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        })
      }
      throw new Error(`unexpected fetch to ${url}`)
    }) as unknown as typeof fetch

    const provider = createTypecastProvider({ apiKey: 'sekret' })
    const chunks: Uint8Array[] = []
    for await (const c of provider.capabilities.speech!.synthesize(
      { text: '안녕하세요', voice: 'actor-123' },
      { model: 'actor-123' },
    )) {
      chunks.push(c)
    }

    expect(chunks.length).toBeGreaterThan(0)
    // First two calls (submit + poll) use the apiKey; download call is a plain GET.
    const submitCall = calls[0]
    expect(submitCall.url).toBe('https://typecast.ai/api/speak')
    const submitHeaders = submitCall.init?.headers as Record<string, string> | undefined
    expect(submitHeaders?.authorization).toBe('Bearer sekret')
    const pollCall = calls[1]
    expect(pollCall.url).toBe('https://typecast.ai/api/speak/status/abc')
    const pollHeaders = pollCall.init?.headers as Record<string, string> | undefined
    expect(pollHeaders?.authorization).toBe('Bearer sekret')
  })

  it('throws E_NO_CREDENTIAL when invoked without apiKey', async () => {
    const provider = createTypecastProvider({})
    const iter = provider.capabilities.speech!.synthesize(
      { text: 'hi', voice: 'actor-123' },
      { model: 'actor-123' },
    )
    await expect(iter.next()).rejects.toMatchObject({ code: 'E_NO_CREDENTIAL' })
  })

  it('throws E_NO_MODEL when no actor_id is available', async () => {
    const provider = createTypecastProvider({ apiKey: 'k' })
    const iter = provider.capabilities.speech!.synthesize(
      { text: 'hi' },
      { model: '' },
    )
    await expect(iter.next()).rejects.toMatchObject({ code: 'E_NO_MODEL' })
  })
})
