import type { ChatMessage, TextChunk } from '../../capabilities/types.js'
import type { TextCapability, TextChatInput, TextChatOptions } from '../../capabilities/text.js'
import type { VisionCapability, VisionDescribeInput, VisionDescribeOptions } from '../../capabilities/vision.js'
import type { ProviderConfig } from '../../config/schema.js'
import { httpRequest, httpJson } from '../../utils/http.js'
import { iterSse } from '../../utils/sse.js'
import { makeProvider, type Provider } from '../base.js'
import { readImageRef } from '../shared/imageRef.js'

const DEFAULT_ENDPOINT = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

interface AnthropicContentBlockDelta {
  type: 'content_block_delta'
  delta: { type: 'text_delta'; text: string }
}
interface AnthropicMessageDelta {
  type: 'message_delta'
  usage?: { output_tokens?: number }
}
interface AnthropicMessageStart {
  type: 'message_start'
  message: { usage?: { input_tokens?: number; output_tokens?: number } }
}

export function createAnthropicProvider(cfg: ProviderConfig): Provider {
  const endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT
  const apiKey = cfg.apiKey ?? ''

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
  }

  const text: TextCapability = {
    async *chat(input: TextChatInput, opts: TextChatOptions) {
      const body = buildMessagesBody(input, opts)
      if (opts.stream === false) {
        const json = (await httpJson({
          provider: 'anthropic',
          url: `${endpoint}/v1/messages`,
          headers,
          json: { ...body, stream: false },
          signal: opts.signal,
        })) as {
          content: Array<{ type: string; text?: string }>
          usage?: { input_tokens?: number; output_tokens?: number }
        }
        const txt = (json.content ?? []).map((b) => b.text ?? '').join('')
        const chunk: TextChunk = {
          text: txt,
          done: true,
          usage: json.usage
            ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens }
            : undefined,
        }
        yield chunk
        return
      }

      const res = await httpRequest({
        provider: 'anthropic',
        url: `${endpoint}/v1/messages`,
        headers: { ...headers, accept: 'text/event-stream' },
        json: { ...body, stream: true },
        signal: opts.signal,
      })

      let inputTokens: number | undefined
      let outputTokens: number | undefined

      for await (const ev of iterSse(res.body)) {
        if (!ev.data || ev.data === '[DONE]') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(ev.data)
        } catch {
          continue
        }
        const obj = parsed as { type?: string }
        if (obj.type === 'message_start') {
          const u = (parsed as AnthropicMessageStart).message.usage
          if (u?.input_tokens !== undefined) inputTokens = u.input_tokens
        } else if (obj.type === 'content_block_delta') {
          const delta = (parsed as AnthropicContentBlockDelta).delta
          if (delta?.type === 'text_delta' && delta.text) {
            yield { text: delta.text }
          }
        } else if (obj.type === 'message_delta') {
          const u = (parsed as AnthropicMessageDelta).usage
          if (u?.output_tokens !== undefined) outputTokens = u.output_tokens
        } else if (obj.type === 'message_stop') {
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
        provider: 'anthropic',
        url: `${endpoint}/v1/messages`,
        headers,
        json: {
          model: opts.model,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mime, data: b64 },
                },
                { type: 'text', text: input.prompt ?? 'Describe this image concisely.' },
              ],
            },
          ],
        },
        signal: opts.signal,
      })) as {
        content: Array<{ type: string; text?: string }>
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      const text = (json.content ?? []).map((b) => b.text ?? '').join('')
      return {
        text,
        usage: json.usage
          ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens }
          : undefined,
      }
    },
  }

  return makeProvider('anthropic', { text, vision })
}

function buildMessagesBody(input: TextChatInput, opts: TextChatOptions): Record<string, unknown> {
  const messages = toAnthropicMessages(input.messages)
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    messages,
  }
  if (input.system) body.system = input.system
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  return body
}

function toAnthropicMessages(
  messages: ChatMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
}
