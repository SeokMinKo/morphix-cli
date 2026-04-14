import type { ImageRef, Usage } from './types.js'

export interface VisionDescribeInput {
  image: ImageRef
  prompt?: string
}

export interface VisionDescribeOptions {
  model: string
  signal?: AbortSignal
}

export interface VisionCapability {
  describe(
    input: VisionDescribeInput,
    opts: VisionDescribeOptions,
  ): Promise<{ text: string; usage?: Usage }>
}
