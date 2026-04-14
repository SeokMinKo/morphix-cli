import type { TextChunk } from '../../capabilities/types.js'
import type { TextCapability, TextChatInput, TextChatOptions } from '../../capabilities/text.js'
import type { VisionCapability, VisionDescribeInput, VisionDescribeOptions } from '../../capabilities/vision.js'
import type { ProviderConfig } from '../../config/schema.js'
import { httpJson, httpRequest } from '../../utils/http.js'
import { iterSse } from '../../utils/sse.js'
import { makeProvider, type Provider } from '../base.js'
import { readImageRef } from '../shared/imageRef.js'

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com'

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

export function createGeminiProvider(cfg: ProviderConfig): Provider {
  const endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT
  const apiKey = cfg.apiKey ?? ''

  function genUrl(model: string, action: 'generateContent' | 'streamGenerateContent'): string {
    const key = apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''
    const suffix = action === 'streamGenerateContent' ? `${key}${key ? '&' : '?'}alt=sse` : key
    return `${endpoint}/v1beta/models/${encodeURIComponent(model)}:${action}${suffix}`
  }

  const text: TextCapability = {
    async *chat(input: TextChatInput, opts: TextChatOptions) {
      const contents = input.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))
      const body: Record<string, unknown> = { contents }
      if (input.system) body.systemInstruction = { parts: [{ text: input.system }] }
      const gen: Record<string, unknown> = {}
      if (opts.temperature !== undefined) gen.temperature = opts.temperature
      if (opts.maxTokens !== undefined) gen.maxOutputTokens = opts.maxTokens
      if (Object.keys(gen).length > 0) body.generationConfig = gen

      if (opts.stream === false) {
        const json = (await httpJson({
          provider: 'gemini',
          url: genUrl(opts.model, 'generateContent'),
          json: body,
          signal: opts.signal,
        })) as GeminiGenerateResponse
        const txt =
          json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
        yield {
          text: txt,
          done: true,
          usage: json.usageMetadata
            ? {
                inputTokens: json.usageMetadata.promptTokenCount,
                outputTokens: json.usageMetadata.candidatesTokenCount,
                totalTokens: json.usageMetadata.totalTokenCount,
              }
            : undefined,
        }
        return
      }

      const res = await httpRequest({
        provider: 'gemini',
        url: genUrl(opts.model, 'streamGenerateContent'),
        headers: { accept: 'text/event-stream' },
        json: body,
        signal: opts.signal,
      })

      let inputTokens: number | undefined
      let outputTokens: number | undefined
      for await (const ev of iterSse(res.body)) {
        if (!ev.data) continue
        let parsed: GeminiGenerateResponse
        try {
          parsed = JSON.parse(ev.data) as GeminiGenerateResponse
        } catch {
          continue
        }
        const parts = parsed.candidates?.[0]?.content?.parts ?? []
        for (const p of parts) {
          if (p.text) yield { text: p.text } satisfies TextChunk
        }
        if (parsed.usageMetadata) {
          inputTokens = parsed.usageMetadata.promptTokenCount
          outputTokens = parsed.usageMetadata.candidatesTokenCount
        }
        if (parsed.candidates?.[0]?.finishReason) {
          yield {
            text: '',
            done: true,
            usage:
              inputTokens !== undefined || outputTokens !== undefined
                ? { inputTokens, outputTokens }
                : undefined,
          }
        }
      }
    },
  }

  const vision: VisionCapability = {
    async describe(input: VisionDescribeInput, opts: VisionDescribeOptions) {
      const { bytes, mime } = await readImageRef(input.image)
      const b64 = Buffer.from(bytes).toString('base64')
      const json = (await httpJson({
        provider: 'gemini',
        url: genUrl(opts.model, 'generateContent'),
        json: {
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: mime, data: b64 } },
                { text: input.prompt ?? 'Describe this image concisely.' },
              ],
            },
          ],
        },
        signal: opts.signal,
      })) as GeminiGenerateResponse
      const txt =
        json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      return {
        text: txt,
        usage: json.usageMetadata
          ? {
              inputTokens: json.usageMetadata.promptTokenCount,
              outputTokens: json.usageMetadata.candidatesTokenCount,
            }
          : undefined,
      }
    },
  }

  return makeProvider('gemini', { text, vision })
}
