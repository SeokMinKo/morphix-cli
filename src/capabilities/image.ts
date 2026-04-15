import type { Asset, Usage } from './types.js'

export interface SubjectReference {
  bytes: Uint8Array
  mime: string
  /** Optional natural-language hint for the subject. Gemini uses this. */
  description?: string
}

export interface ImageGenerateInput {
  prompt: string
  n?: number
  aspectRatio?: string
  size?: string
  /**
   * Reference images describing the subject/character the generator should
   * preserve. Each entry is a decoded image payload ready to send upstream.
   * Providers that don't support subject refs will throw
   * UnsupportedCapabilityError when this is non-empty.
   */
  subjectRefs?: SubjectReference[]
}

export interface ImageGenerateOptions {
  model: string
  signal?: AbortSignal
}

export interface ImageCapability {
  generate(
    input: ImageGenerateInput,
    opts: ImageGenerateOptions,
  ): Promise<{ assets: Asset[]; usage?: Usage }>
}
