import type { ChatMessage, TextChunk } from './types.js'

export interface TextChatInput {
  messages: ChatMessage[]
  system?: string
}

export interface TextChatOptions {
  model: string
  stream?: boolean
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
}

export interface TextCapability {
  chat(input: TextChatInput, opts: TextChatOptions): AsyncIterable<TextChunk>
}
