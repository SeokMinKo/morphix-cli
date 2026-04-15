import type { Voice } from './types.js'

export interface SpeechSynthesizeInput {
  text: string
  voice?: string
  speed?: number
  pitch?: number
}

export interface SpeechSynthesizeOptions {
  model: string
  signal?: AbortSignal
  /** Hint; implementations may ignore if the backend only supports one encoding. */
  format?: 'mp3' | 'wav' | 'opus' | 'pcm'
}

export interface SpeechCapability {
  synthesize(
    input: SpeechSynthesizeInput,
    opts: SpeechSynthesizeOptions,
  ): AsyncIterable<Uint8Array>
  voices?(): Promise<Voice[]>
}
