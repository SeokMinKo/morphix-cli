import { loadRawConfig, saveConfig } from '../config/file.js'
import type { ProviderConfig } from '../config/schema.js'

/**
 * Persist a credential (apiKey or endpoint) for a provider in the config
 * file. File permissions are enforced by saveConfig (dir 0700, file 0600).
 *
 * Only the raw (user-specified) on-disk config is mutated so that built-in
 * defaults remain fluid across upgrades.
 */
export async function saveCredential(
  provider: string,
  cred: ProviderConfig,
): Promise<string> {
  const raw = await loadRawConfig()
  const providers = { ...(raw.providers ?? {}) }
  const existing = providers[provider] ?? {}
  providers[provider] = {
    ...existing,
    ...cred,
    extra: { ...(existing.extra ?? {}), ...(cred.extra ?? {}) },
  }
  raw.providers = providers
  return saveConfig(raw)
}

/** Remove a provider's credentials from the config file. */
export async function removeCredential(provider: string): Promise<string> {
  const raw = await loadRawConfig()
  if (raw.providers) delete raw.providers[provider]
  return saveConfig(raw)
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
