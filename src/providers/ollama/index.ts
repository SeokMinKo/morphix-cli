import type { ChatMessage, TextChunk } from '../../capabilities/types.js'
import type { TextCapability, TextChatInput, TextChatOptions } from '../../capabilities/text.js'
import type { VisionCapability, VisionDescribeInput, VisionDescribeOptions } from '../../capabilities/vision.js'
import type { ProviderConfig } from '../../config/schema.js'
import { httpRequest, httpJson } from '../../utils/http.js'
import { iterNdjson } from '../../utils/sse.js'
import { makeProvider, type Provider } from '../base.js'
import { readImageRef } from '../shared/imageRef.js'

const DEFAULT_ENDPOINT = 'http://localhost:11434'

interface OllamaChatChunk {
  message?: { content?: string }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

export function createOllamaProvider(cfg: ProviderConfig): Provider {
  const endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT

  const text: TextCapability = {
    async *chat(input: TextChatInput, opts: TextChatOptions) {
      const messages = toOllamaMessages(input)
      const stream = opts.stream !== false

      if (!stream) {
        const json = (await httpJson({
          provider: 'ollama',
          url: `${endpoint}/api/chat`,
          json: { model: opts.model, messages, stream: false },
          signal: opts.signal,
        })) as OllamaChatChunk
        yield {
          text: json.message?.content ?? '',
          done: true,
          usage: {
            inputTokens: json.prompt_eval_count,
            outputTokens: json.eval_count,
          },
        }
        return
      }

      const res = await httpRequest({
        provider: 'ollama',
        url: `${endpoint}/api/chat`,
        json: { model: opts.model, messages, stream: true },
        signal: opts.signal,
      })
      let inputTokens: number | undefined
      let outputTokens: number | undefined
      for await (const obj of iterNdjson<OllamaChatChunk>(res.body)) {
        if (obj.message?.content) {
          yield { text: obj.message.content } satisfies TextChunk
        }
        if (obj.prompt_eval_count !== undefined) inputTokens = obj.prompt_eval_count
        if (obj.eval_count !== undefined) outputTokens = obj.eval_count
        if (obj.done) {
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
      const { bytes } = await readImageRef(input.image)
      const b64 = Buffer.from(bytes).toString('base64')
      const json = (await httpJson({
        provider: 'ollama',
        url: `${endpoint}/api/chat`,
        json: {
          model: opts.model,
          stream: false,
          messages: [
            {
              role: 'user',
              content: input.prompt ?? 'Describe this image concisely.',
              images: [b64],
            },
          ],
        },
        signal: opts.signal,
      })) as OllamaChatChunk
      return { text: json.message?.content ?? '' }
    },
  }

  return makeProvider('ollama', { text, vision })
}

function toOllamaMessages(input: TextChatInput): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = []
  if (input.system) msgs.push({ role: 'system', content: input.system })
  for (const m of input.messages) {
    msgs.push({ role: m.role, content: m.content })
  }
  return msgs
}

// Silence unused import warning on some TS configs.
export type { ChatMessage }
