/** Shared types referenced by all capability interfaces. */

export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: Role
  content: string
}

export interface TextChunk {
  /** Incremental text delta. Empty string is valid for keep-alive events. */
  text: string
  /** Final chunk sets done=true; consumers may surface usage on this chunk. */
  done?: boolean
  usage?: Usage
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface Asset {
  kind: 'image' | 'audio' | 'video' | 'file'
  /** Raw bytes if the provider returned inline data. */
  bytes?: Uint8Array
  /** Remote URL if the provider returned a downloadable link. */
  url?: string
  /** MIME type, e.g. "image/png". */
  mime: string
  /** Suggested filename extension (no dot), e.g. "png". */
  ext?: string
}

export interface JobStatus {
  jobId: string
  state: 'pending' | 'running' | 'done' | 'error'
  progress?: number
  error?: string
}

export interface Voice {
  id: string
  name: string
  language?: string
  gender?: string
}

export interface SearchResult {
  title: string
  url: string
  snippet?: string
}

export type ImageRef =
  | { kind: 'path'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'bytes'; bytes: Uint8Array; mime: string }
