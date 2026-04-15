import type { SearchResult } from './types.js'

export interface SearchQueryInput {
  q: string
}

export interface SearchQueryOptions {
  model?: string
  signal?: AbortSignal
  limit?: number
}

export interface SearchCapability {
  query(
    input: SearchQueryInput,
    opts: SearchQueryOptions,
  ): Promise<{ results: SearchResult[]; answer?: string }>
}
