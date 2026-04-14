import { UnsupportedCapabilityError, MorphixError } from '../utils/errors.js'
import type { Capability, ProviderConfig, ProviderId } from '../config/schema.js'
import { PROVIDER_IDS } from '../config/schema.js'
import type { CapabilityMap, Provider, ProviderFactory } from './base.js'

/** Lazy registry: factories are registered here; instances built on demand. */
const factories = new Map<ProviderId, ProviderFactory>()

export function registerProvider(id: ProviderId, factory: ProviderFactory): void {
  factories.set(id, factory)
}

export function hasProvider(id: string): id is ProviderId {
  return factories.has(id as ProviderId)
}

/** Build a provider instance for a given config. Throws if unknown. */
export function buildProvider(id: string, cfg: ProviderConfig): Provider {
  const factory = factories.get(id as ProviderId)
  if (!factory) {
    throw new MorphixError(`Unknown provider: '${id}'`, {
      code: 'E_UNKNOWN_PROVIDER',
      exitCode: 64,
      hint: `Valid providers: ${Array.from(factories.keys()).join(', ')}`,
    })
  }
  return factory(cfg)
}

/** List all provider IDs that support a given capability (after the provider has been registered). */
export function listProvidersFor(cap: Capability): ProviderId[] {
  const out: ProviderId[] = []
  for (const [id, factory] of factories) {
    try {
      // Use an empty config just to probe which capabilities are declared. Providers
      // must not do network I/O in their factory — capability declarations are static.
      const probe = factory({})
      if (probe.supports(cap)) out.push(id)
    } catch {
      // ignore factories that can't be probed with an empty config
    }
  }
  return out
}

/**
 * Look up the capability implementation for (capability, providerId). Throws
 * UnsupportedCapabilityError with a list of valid alternatives when the
 * provider doesn't declare that capability.
 */
export function getCapability<K extends Capability>(
  cap: K,
  providerId: string,
  cfg: ProviderConfig,
): { provider: Provider; impl: NonNullable<CapabilityMap[K]> } {
  const provider = buildProvider(providerId, cfg)
  const impl = provider.capabilities[cap]
  if (!impl) {
    throw new UnsupportedCapabilityError(providerId, cap, listProvidersFor(cap))
  }
  return { provider, impl: impl as NonNullable<CapabilityMap[K]> }
}

/** Registered provider IDs (in deterministic declared order). */
export function registeredIds(): ProviderId[] {
  return PROVIDER_IDS.filter((id) => factories.has(id))
}
