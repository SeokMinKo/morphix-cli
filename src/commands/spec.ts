/**
 * Machine-readable metadata for every command. Exposed via `mx schema` so
 * LLM agents can enumerate commands, flags, and expected outputs without
 * parsing the ANSI help text.
 *
 * Each command module exports `export const spec: CommandSpec`. The `schema`
 * and `list` commands aggregate these into a single JSON manifest.
 */
export type FlagType = 'string' | 'number' | 'boolean' | 'path' | 'repeated-string'

export interface FlagSpec {
  name: string
  type: FlagType
  alias?: string
  required?: boolean
  repeatable?: boolean
  enum?: readonly string[]
  default?: string | number | boolean
  description: string
}

export interface OutputSpec {
  kind: 'path' | 'text' | 'json' | 'stream' | 'bytes-stdout'
  description: string
  /** When kind='json', a free-form hint of the shape (not a full JSON schema). */
  shape?: string
}

export interface CommandSpec {
  name: string
  summary: string
  /** Capability this command fronts, if applicable. */
  capability?: 'text' | 'image' | 'video' | 'speech' | 'music' | 'vision' | 'search'
  subcommands?: CommandSpec[]
  flags?: FlagSpec[]
  outputs?: OutputSpec[]
  examples?: string[]
}

export const PROVIDER_FLAG: FlagSpec = {
  name: 'provider',
  type: 'string',
  description: 'Provider id override. Precedence: flag > env > config.',
  enum: ['anthropic', 'openai', 'gemini', 'ollama', 'comfyui'],
}

export const MODEL_FLAG: FlagSpec = {
  name: 'model',
  type: 'string',
  description: 'Provider-specific model identifier.',
}

export const GLOBAL_FLAGS: FlagSpec[] = [
  {
    name: 'json',
    type: 'boolean',
    description: 'Emit a single-line JSON envelope on stdout (stderr on error) for AI consumption.',
  },
  {
    name: 'non-interactive',
    type: 'boolean',
    description: 'Refuse any TTY prompt. All required inputs must come from flags or stdin.',
  },
  {
    name: 'quiet',
    type: 'boolean',
    description: 'Suppress progress messages on stderr (state=running …).',
  },
]
