import { loadConfig, saveConfig } from '../config/file.js'
import type { ProviderConfig } from '../config/schema.js'

/**
 * Persist a credential (apiKey or endpoint) for a provider in the config
 * file. File permissions are enforced by saveConfig (dir 0700, file 0600).
 */
export async function saveCredential(
  provider: string,
  cred: ProviderConfig,
): Promise<string> {
  const config = await loadConfig()
  const existing = config.providers[provider] ?? {}
  config.providers[provider] = {
    ...existing,
    ...cred,
    extra: { ...(existing.extra ?? {}), ...(cred.extra ?? {}) },
  }
  return saveConfig(config)
}

/** Remove a provider's credentials from the config file. */
export async function removeCredential(provider: string): Promise<string> {
  const config = await loadConfig()
  delete config.providers[provider]
  return saveConfig(config)
}

/**
 * Return the masked form of a secret for display, e.g. "sk-ant-…abcd".
 * Shows the first 7 chars (typically the key prefix) and last 4.
 */
export function maskSecret(value: string | undefined): string {
  if (!value) return '(not set)'
  if (value.length <= 12) return '***'
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}
