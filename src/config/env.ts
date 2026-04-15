import type { Capability, ProviderConfig } from './schema.js'

export type Env = Record<string, string | undefined>

/** Per-feature provider env var, e.g. MORPHIX_TEXT_PROVIDER. */
export function featureProviderEnv(feature: Capability, env: Env = process.env): string | undefined {
  return env[`MORPHIX_${feature.toUpperCase()}_PROVIDER`]
}

/** Per-feature model env var, e.g. MORPHIX_TEXT_MODEL. */
export function featureModelEnv(feature: Capability, env: Env = process.env): string | undefined {
  return env[`MORPHIX_${feature.toUpperCase()}_MODEL`]
}

/**
 * Build a ProviderConfig from env vars for a given provider. Returns an
 * empty object if nothing is set — callers merge this on top of the
 * file-based config.
 */
export function providerConfigFromEnv(provider: string, env: Env = process.env): ProviderConfig {
  switch (provider) {
    case 'anthropic':
      return pick({ apiKey: env.ANTHROPIC_API_KEY })
    case 'openai':
      return pick({
        apiKey: env.OPENAI_API_KEY,
        endpoint: env.OPENAI_BASE_URL,
      })
    case 'gemini':
      return pick({
        apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY,
      })
    case 'ollama':
      return pick({ endpoint: env.OLLAMA_HOST })
    case 'comfyui': {
      const cfg: ProviderConfig = pick({ endpoint: env.COMFYUI_HOST })
      if (env.COMFYUI_WORKFLOW) {
        cfg.extra = { ...(cfg.extra ?? {}), workflow: env.COMFYUI_WORKFLOW }
      }
      return cfg
    }
    default:
      return {}
  }
}

function pick<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== '') out[k] = v
  }
  return out as T
}

/** Merge two ProviderConfigs; the second argument wins. */
export function mergeProviderConfig(a: ProviderConfig = {}, b: ProviderConfig = {}): ProviderConfig {
  return {
    apiKey: b.apiKey ?? a.apiKey,
    endpoint: b.endpoint ?? a.endpoint,
    extra: { ...(a.extra ?? {}), ...(b.extra ?? {}) },
  }
}
