import { loadConfig } from '../config/file.js'
import { maskSecret } from '../auth/keystore.js'
import { needsApiKey } from '../config/schema.js'
import { providerConfigFromEnv } from '../config/env.js'

/**
 * Minimal quota view. Most providers don't expose a uniform usage endpoint,
 * so for now this just lists configured providers and whether a credential
 * is present. Per-provider real quota lookups can be added iteratively.
 */
export async function quotaCommand(_argv: string[]): Promise<void> {
  const config = await loadConfig()
  const ids = ['anthropic', 'openai', 'gemini', 'ollama', 'comfyui']
  console.log('Provider readiness (credentials/endpoints):\n')
  for (const id of ids) {
    const file = config.providers[id] ?? {}
    const env = providerConfigFromEnv(id)
    const apiKey = env.apiKey ?? file.apiKey
    const endpoint = env.endpoint ?? file.endpoint
    const ready = needsApiKey(id) ? !!apiKey : !!endpoint
    const detail = needsApiKey(id) ? `key=${maskSecret(apiKey)}` : `endpoint=${endpoint ?? '(none)'}`
    console.log(`  ${id.padEnd(10)}  ready=${ready}  ${detail}`)
  }
  console.log(
    '\nNote: per-provider usage / remaining credits will be queried individually in a future release.',
  )
}
