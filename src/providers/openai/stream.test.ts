import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createOpenAiProvider } from './index.js'

/**
 * Regression test: OpenAI streams the final `usage` chunk AFTER the
 * finish_reason chunk when stream_options.include_usage is set. A prior bug
 * emitted `done: true` on finish_reason (before usage arrived) and dropped
 * the token counts on the floor.
 */
describe('OpenAI streaming usage surfacing', () => {
  const origFetch = globalThis.fetch
  beforeEach(() => {
    /* noop */
  })
  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('emits usage on the terminal done chunk (after finish_reason)', async () => {
    const sseBody = [
      // normal content chunks
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hel' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n\n`,
      // finish_reason chunk (no usage yet)
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
      // terminal usage-only chunk (empty choices)
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 5 } })}\n\n`,
      `data: [DONE]\n\n`,
    ].join('')

    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody))
        controller.close()
      },
    })
    globalThis.fetch = vi.fn(async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ) as unknown as typeof fetch

    const provider = createOpenAiProvider({ apiKey: 'sk-test' })
    const out: Array<{ text: string; done?: boolean; usage?: { inputTokens?: number; outputTokens?: number } }> = []
    for await (const chunk of provider.capabilities.text!.chat(
      { messages: [{ role: 'user', content: 'hi' }] },
      { model: 'gpt-4o-mini' },
    )) {
      out.push(chunk)
    }
    const last = out[out.length - 1]
    expect(last.done).toBe(true)
    expect(last.usage).toEqual({ inputTokens: 3, outputTokens: 5 })
    // And only ONE done chunk was emitted.
    expect(out.filter((c) => c.done).length).toBe(1)
    expect(out.map((c) => c.text).join('')).toBe('hello')
  })
})
