import type { Asset, Usage } from './types.js'

export interface ImageGenerateInput {
  prompt: string
  n?: number
  aspectRatio?: string
  size?: string
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
