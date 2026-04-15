/**
 * Config shapes. We intentionally keep this hand-rolled (no zod) to preserve
 * zero-prod-deps. Validators are minimal — we trust the file (owned by user)
 * and fall back to defaults for anything missing.
 */

export const CAPABILITIES = [
  'text',
  'image',
  'video',
  'speech',
  'music',
  'vision',
  'search',
] as const
export type Capability = (typeof CAPABILITIES)[number]

export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'gemini',
  'ollama',
  'comfyui',
  'piapi',
  'typecast',
] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export interface FeatureDefault {
  provider?: string
  model?: string
}

export interface ProviderConfig {
  apiKey?: string
  endpoint?: string
  extra?: Record<string, string>
}

export interface MorphixConfig {
  version: number
  defaults: Partial<Record<Capability, FeatureDefault>>
  providers: Partial<Record<string, ProviderConfig>>
  outputDir?: string
}

export const DEFAULT_CONFIG: MorphixConfig = {
  version: 1,
  defaults: {
    text: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    image: { provider: 'openai', model: 'gpt-image-1' },
    video: { provider: 'gemini', model: 'veo-3.0' },
    speech: { provider: 'openai', model: 'tts-1' },
    music: { provider: 'comfyui', model: 'ace-step' },
    vision: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    search: { provider: 'gemini', model: 'gemini-2.5-flash' },
  },
  providers: {
    ollama: { endpoint: 'http://localhost:11434' },
    comfyui: { endpoint: 'http://localhost:8188' },
    piapi: { endpoint: 'https://api.piapi.ai' },
    typecast: { endpoint: 'https://typecast.ai' },
  },
  outputDir: '~/morphix-out',
}

export function isCapability(s: string): s is Capability {
  return (CAPABILITIES as readonly string[]).includes(s)
}

export function isProviderId(s: string): s is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(s)
}

/** Per-provider default model for each capability, used as last-resort fallback. */
export const PROVIDER_DEFAULT_MODELS: Record<ProviderId, Partial<Record<Capability, string>>> = {
  anthropic: {
    text: 'claude-sonnet-4-5',
    vision: 'claude-sonnet-4-5',
  },
  openai: {
    text: 'gpt-4o-mini',
    image: 'gpt-image-1',
    speech: 'tts-1',
    vision: 'gpt-4o-mini',
    search: 'gpt-4o-mini',
  },
  gemini: {
    text: 'gemini-2.5-flash',
    image: 'imagen-3.0-generate-002',
    video: 'veo-3.0',
    speech: 'gemini-2.5-flash-preview-tts',
    vision: 'gemini-2.5-flash',
    search: 'gemini-2.5-flash',
  },
  ollama: {
    text: 'llama3.2',
    vision: 'llava',
  },
  comfyui: {
    image: 'ace-step',
    video: 'ace-step',
    music: 'ace-step',
  },
  piapi: {
    image: 'Qubico/flux1-schnell',
    video: 'kling',
    music: 'music-u',
  },
  typecast: {
    speech: '',
  },
}

/** Whether a provider requires an API key (vs only an endpoint). */
export function needsApiKey(provider: string): boolean {
  return (
    provider === 'anthropic' ||
    provider === 'openai' ||
    provider === 'gemini' ||
    provider === 'piapi' ||
    provider === 'typecast'
  )
}

/** Native env var name for a provider's API key, used for error hints. */
export function apiKeyEnvName(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY'
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'gemini':
      return 'GEMINI_API_KEY'
    case 'piapi':
      return 'PIAPI_API_KEY'
    case 'typecast':
      return 'TYPECAST_API_KEY'
    default:
      return `${provider.toUpperCase()}_API_KEY`
  }
}
