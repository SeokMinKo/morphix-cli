import type { TextChunk } from '../../capabilities/types.js'
import type { TextCapability, TextChatInput, TextChatOptions } from '../../capabilities/text.js'
import type { VisionCapability, VisionDescribeInput, VisionDescribeOptions } from '../../capabilities/vision.js'
import type { ImageCapability, ImageGenerateInput, ImageGenerateOptions } from '../../capabilities/image.js'
import type {
  SpeechCapability,
  SpeechSynthesizeInput,
  SpeechSynthesizeOptions,
} from '../../capabilities/speech.js'
import type { SearchCapability, SearchQueryInput, SearchQueryOptions } from '../../capabilities/search.js'
import type { Asset, SearchResult, Voice } from '../../capabilities/types.js'
import type { ProviderConfig } from '../../config/schema.js'
import { httpRequest, httpJson } from '../../utils/http.js'
import { iterSse } from '../../utils/sse.js'
import { makeProvider, type Provider } from '../base.js'
import { readImageRef } from '../shared/imageRef.js'

const DEFAULT_ENDPOINT = 'https://api.openai.com'

interface OpenAiDelta {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

export function createOpenAiProvider(cfg: ProviderConfig): Provider {
  const endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT
  const apiKey = cfg.apiKey ?? ''
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` }

  const text: TextCapability = {
    async *chat(input: TextChatInput, opts: TextChatOptions) {
      const messages: Array<{ role: string; content: string }> = []
      if (input.system) messages.push({ role: 'system', content: input.system })
      for (const m of input.messages) messages.push({ role: m.role, content: m.content })

      const base: Record<string, unknown> = { model: opts.model, messages }
      if (opts.temperature !== undefined) base.temperature = opts.temperature
      if (opts.maxTokens !== undefined) base.max_tokens = opts.maxTokens

      if (opts.stream === false) {
        const json = (await httpJson({
          provider: 'openai',
          url: `${endpoint}/v1/chat/completions`,
          headers,
          json: { ...base, stream: false },
          signal: opts.signal,
        })) as {
          choices: Array<{ message?: { content?: string } }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        const txt = json.choices?.[0]?.message?.content ?? ''
        yield {
          text: txt,
          done: true,
          usage: json.usage
            ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
            : undefined,
        }
        return
      }

      const res = await httpRequest({
        provider: 'openai',
        url: `${endpoint}/v1/chat/completions`,
        headers: { ...headers, accept: 'text/event-stream' },
        json: { ...base, stream: true, stream_options: { include_usage: true } },
        signal: opts.signal,
      })

      let inputTokens: number | undefined
      let outputTokens: number | undefined
      for await (const ev of iterSse(res.body)) {
        if (!ev.data || ev.data === '[DONE]') continue
        let parsed: OpenAiDelta
        try {
          parsed = JSON.parse(ev.data) as OpenAiDelta
        } catch {
          continue
        }
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) yield { text: delta } satisfies TextChunk
        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens
          outputTokens = parsed.usage.completion_tokens
        }
        if (parsed.choices?.[0]?.finish_reason) {
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
      let imageUrl: string
      if (input.image.kind === 'url') {
        imageUrl = input.image.url
      } else {
        const { bytes, mime } = await readImageRef(input.image)
        imageUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
      }
      const json = (await httpJson({
        provider: 'openai',
        url: `${endpoint}/v1/chat/completions`,
        headers,
        json: {
          model: opts.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: input.prompt ?? 'Describe this image concisely.' },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
        },
        signal: opts.signal,
      })) as {
        choices: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        usage: json.usage
          ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
          : undefined,
      }
    },
  }

  const image: ImageCapability = {
    async generate(input: ImageGenerateInput, opts: ImageGenerateOptions) {
      // OpenAI images endpoint. `size` is "WxH" or keywords like "auto"/"1024x1024".
      const size = normalizeSize(input.size ?? input.aspectRatio)
      const json = (await httpJson({
        provider: 'openai',
        url: `${endpoint}/v1/images/generations`,
        headers,
        json: {
          model: opts.model,
          prompt: input.prompt,
          n: input.n ?? 1,
          size,
        },
        signal: opts.signal,
      })) as {
        data: Array<{ b64_json?: string; url?: string }>
        usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
      }
      const assets: Asset[] = (json.data ?? []).map((d) => {
        if (d.b64_json) {
          return {
            kind: 'image' as const,
            bytes: Buffer.from(d.b64_json, 'base64'),
            mime: 'image/png',
            ext: 'png',
          }
        }
        return { kind: 'image' as const, url: d.url ?? '', mime: 'image/png', ext: 'png' }
      })
      return {
        assets,
        usage: json.usage
          ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens }
          : undefined,
      }
    },
  }

  const speech: SpeechCapability = {
    async *synthesize(input: SpeechSynthesizeInput, opts: SpeechSynthesizeOptions) {
      const format = opts.format ?? 'mp3'
      const res = await httpRequest({
        provider: 'openai',
        url: `${endpoint}/v1/audio/speech`,
        headers,
        json: {
          model: opts.model,
          voice: input.voice ?? 'alloy',
          input: input.text,
          response_format: format,
          speed: input.speed ?? 1.0,
        },
        signal: opts.signal,
      })
      // OpenAI returns the whole audio file in one response; stream it out
      // in whatever chunk sizes fetch produces.
      if (!res.body) {
        yield new Uint8Array(await res.arrayBuffer())
        return
      }
      const reader = res.body.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) yield value
        }
      } finally {
        reader.releaseLock()
      }
    },
    async voices(): Promise<Voice[]> {
      // OpenAI doesn't expose a voices endpoint; return the documented set.
      return [
        { id: 'alloy', name: 'Alloy' },
        { id: 'ash', name: 'Ash' },
        { id: 'ballad', name: 'Ballad' },
        { id: 'coral', name: 'Coral' },
        { id: 'echo', name: 'Echo' },
        { id: 'fable', name: 'Fable' },
        { id: 'nova', name: 'Nova' },
        { id: 'onyx', name: 'Onyx' },
        { id: 'sage', name: 'Sage' },
        { id: 'shimmer', name: 'Shimmer' },
        { id: 'verse', name: 'Verse' },
      ]
    },
  }

  const search: SearchCapability = {
    async query(input: SearchQueryInput, opts: SearchQueryOptions) {
      // Uses the Responses API's web_search tool. Returns a final message
      // whose text is grounded, plus URL citations in annotations.
      type ResponseOutputItem =
        | {
            type: 'message'
            content?: Array<{
              type: string
              text?: string
              annotations?: Array<{
                type: string
                url?: string
                title?: string
                start_index?: number
                end_index?: number
              }>
            }>
          }
        | {
            type: 'web_search_call'
            action?: { query?: string; sources?: Array<{ url?: string; title?: string }> }
          }
      const json = (await httpJson({
        provider: 'openai',
        url: `${endpoint}/v1/responses`,
        headers,
        json: {
          model: opts.model ?? 'gpt-4o-mini',
          tools: [{ type: 'web_search_preview' }],
          input: input.q,
        },
        signal: opts.signal,
      })) as { output?: ResponseOutputItem[]; output_text?: string }

      let answer = json.output_text ?? ''
      const results: SearchResult[] = []
      const seen = new Set<string>()
      for (const item of json.output ?? []) {
        if (item.type === 'message') {
          for (const part of item.content ?? []) {
            if (!answer && part.type === 'output_text' && part.text) answer = part.text
            for (const ann of part.annotations ?? []) {
              if (ann.type === 'url_citation' && ann.url && !seen.has(ann.url)) {
                seen.add(ann.url)
                results.push({
                  title: ann.title ?? ann.url,
                  url: ann.url,
                })
              }
            }
          }
        } else if (item.type === 'web_search_call') {
          for (const src of item.action?.sources ?? []) {
            if (src.url && !seen.has(src.url)) {
              seen.add(src.url)
              results.push({ title: src.title ?? src.url, url: src.url })
            }
          }
        }
      }
      const limited = opts.limit ? results.slice(0, opts.limit) : results
      return { results: limited, answer: answer || undefined }
    },
  }

  return makeProvider('openai', { text, vision, image, speech, search })
}

function normalizeSize(spec: string | undefined): string {
  if (!spec) return '1024x1024'
  const wh = /^(\d+)x(\d+)$/.exec(spec)
  if (wh) return spec
  // Aspect ratios → nearest supported OpenAI size.
  const ab = /^(\d+):(\d+)$/.exec(spec)
  if (ab) {
    const ratio = Number(ab[1]) / Number(ab[2])
    if (ratio > 1.3) return '1792x1024'
    if (ratio < 0.77) return '1024x1792'
    return '1024x1024'
  }
  return '1024x1024'
}
