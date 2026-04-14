import type { Asset, JobStatus } from './types.js'

export interface VideoGenerateInput {
  prompt: string
  durationSec?: number
  aspectRatio?: string
}

export interface VideoGenerateOptions {
  model: string
  signal?: AbortSignal
}

export interface VideoCapability {
  /** Submit a generation job. Always async. */
  submit(input: VideoGenerateInput, opts: VideoGenerateOptions): Promise<{ jobId: string }>
  /** Poll job state. Non-blocking; caller handles the poll loop. */
  poll(jobId: string): Promise<JobStatus>
  /** Retrieve completed assets for a done job. */
  fetch(jobId: string): Promise<{ assets: Asset[] }>
}
