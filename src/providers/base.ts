import type { Capability, ProviderConfig, ProviderId } from '../config/schema.js'
import type { ImageCapability } from '../capabilities/image.js'
import type { MusicCapability } from '../capabilities/music.js'
import type { SearchCapability } from '../capabilities/search.js'
import type { SpeechCapability } from '../capabilities/speech.js'
import type { TextCapability } from '../capabilities/text.js'
import type { VideoCapability } from '../capabilities/video.js'
import type { VisionCapability } from '../capabilities/vision.js'

export interface CapabilityMap {
  text?: TextCapability
  image?: ImageCapability
  video?: VideoCapability
  speech?: SpeechCapability
  music?: MusicCapability
  vision?: VisionCapability
  search?: SearchCapability
}

export interface Provider {
  id: ProviderId
  capabilities: CapabilityMap
  /** Set of capabilities this provider claims to support; used by registry.listProvidersFor(). */
  supports(cap: Capability): boolean
}

export type ProviderFactory = (cfg: ProviderConfig) => Provider

export function makeProvider(id: ProviderId, capabilities: CapabilityMap): Provider {
  return {
    id,
    capabilities,
    supports(cap: Capability): boolean {
      return capabilities[cap] !== undefined
    },
  }
}
