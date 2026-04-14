import type { Asset } from './types.js'

export interface MusicGenerateInput {
  prompt: string
  lyrics?: string
  instrumental?: boolean
  durationSec?: number
  genre?: string
}

export interface MusicGenerateOptions {
  model: string
  signal?: AbortSignal
}

export type MusicGenerateResult =
  | { kind: 'async'; jobId: string }
  | { kind: 'sync'; assets: Asset[] }

export interface MusicCapability {
  generate(
    input: MusicGenerateInput,
    opts: MusicGenerateOptions,
  ): Promise<MusicGenerateResult>
}
