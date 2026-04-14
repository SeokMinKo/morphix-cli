import type { TextChunk } from '../../capabilities/types.js'
import type { TextCapability, TextChatInput, TextChatOptions } from '../../capabilities/text.js'
import type { VisionCapability, VisionDescribeInput, VisionDescribeOptions } from '../../capabilities/vision.js'
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

      const base: Record<string, unknown> = {
        model: opts.model,
        messages,
      }
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
        if (delta) {
          yield { text: delta } satisfies TextChunk
        }
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

  return makeProvider('openai', { text, vision })
}
