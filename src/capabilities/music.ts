import type { Asset } from './types.js'

export interface MusicGenerateInput {
  prompt: string
  lyrics?: string
  instrumental?: boolean
  durationSec?: number
  genre?: string
}

export interface MusicCoverInput {
  /** Absolute path to a local audio file to use as the source. */
  referenceAudioPath: string
  /** Optional text prompt to steer the stylistic transformation. */
  prompt?: string
  /** Optional lyrics override (for ACE-Step style transfer). */
  lyrics?: string
  /** 0..1 — how strongly the prompt deviates from the reference. */
  strength?: number
  /** Output duration; typically inferred from the source audio. */
  durationSec?: number
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
  /**
   * Audio-to-audio style transfer (ACE-Step I2A). Providers that lack a
   * cover-capable workflow will throw UnsupportedCapabilityError.
   */
  cover?(input: MusicCoverInput, opts: MusicGenerateOptions): Promise<MusicGenerateResult>
}
