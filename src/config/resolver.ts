import {
  MissingCredentialError,
  MissingModelError,
  MissingProviderError,
} from '../utils/errors.js'
import type { Capability, MorphixConfig, ProviderConfig } from './schema.js'
import {
  PROVIDER_DEFAULT_MODELS,
  apiKeyEnvName,
  isProviderId,
  needsApiKey,
} from './schema.js'
import { Env, featureModelEnv, featureProviderEnv, mergeProviderConfig, providerConfigFromEnv } from './env.js'

export interface ResolveInput {
  feature: Capability
  /** CLI flag overrides, pre-normalized. */
  flagProvider?: string
  flagModel?: string
  env?: Env
  config: MorphixConfig
}

export interface Resolved {
  feature: Capability
  provider: string
  model: string
  providerConfig: ProviderConfig
}

/**
 * Resolve (feature → provider, model, credentials) using 3-tier precedence:
 *   1. CLI flags
 *   2. Environment variables (MORPHIX_<FEATURE>_<PROVIDER|MODEL> and provider-native creds)
 *   3. ~/.morphix/config.json
 *
 * Throws MorphixError subclasses (with actionable hints) when something is missing.
 * This function does NOT call the registry — it just produces the lookup tuple.
 */
export function resolve(input: ResolveInput): Resolved {
  const env = input.env ?? process.env
  const { feature, config } = input

  const providerId =
    input.flagProvider ??
    featureProviderEnv(feature, env) ??
    config.defaults[feature]?.provider ??
    undefined
  if (!providerId) throw new MissingProviderError(feature)

  const model =
    input.flagModel ??
    featureModelEnv(feature, env) ??
    config.defaults[feature]?.model ??
    (isProviderId(providerId) ? PROVIDER_DEFAULT_MODELS[providerId]?.[feature] : undefined)
  if (!model) throw new MissingModelError(feature, providerId)

  const providerConfig = mergeProviderConfig(
    config.providers[providerId] ?? {},
    providerConfigFromEnv(providerId, env),
  )
  if (needsApiKey(providerId) && !providerConfig.apiKey) {
    throw new MissingCredentialError(providerId, apiKeyEnvName(providerId))
  }

  return { feature, provider: providerId, model, providerConfig }
}
