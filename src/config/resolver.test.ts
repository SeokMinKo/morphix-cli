import { describe, expect, it } from 'vitest'
import { resolve } from './resolver.js'
import { DEFAULT_CONFIG } from './schema.js'
import {
  MissingCredentialError,
  MissingProviderError,
  MissingModelError,
} from '../utils/errors.js'

function cfg(overrides: Partial<typeof DEFAULT_CONFIG> = {}) {
  const base = structuredClone(DEFAULT_CONFIG)
  return { ...base, ...overrides, defaults: { ...base.defaults, ...(overrides.defaults ?? {}) } }
}

describe('resolver precedence', () => {
  it('uses CLI flag for provider/model over env and file', () => {
    const r = resolve({
      feature: 'text',
      flagProvider: 'openai',
      flagModel: 'gpt-4o-mini',
      env: {
        MORPHIX_TEXT_PROVIDER: 'gemini',
        MORPHIX_TEXT_MODEL: 'gemini-2.5-flash',
        OPENAI_API_KEY: 'sk-test',
      },
      config: cfg(),
    })
    expect(r.provider).toBe('openai')
    expect(r.model).toBe('gpt-4o-mini')
  })

  it('falls back to env when flag missing', () => {
    const r = resolve({
      feature: 'text',
      env: {
        MORPHIX_TEXT_PROVIDER: 'openai',
        MORPHIX_TEXT_MODEL: 'gpt-4o-mini',
        OPENAI_API_KEY: 'sk-test',
      },
      config: cfg(),
    })
    expect(r.provider).toBe('openai')
    expect(r.model).toBe('gpt-4o-mini')
  })

  it('falls back to file config defaults when flag + env missing', () => {
    const r = resolve({
      feature: 'text',
      env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      config: cfg(),
    })
    expect(r.provider).toBe('anthropic')
    expect(r.model).toBe('claude-sonnet-4-5')
  })

  it('env provider + flag model mix works', () => {
    const r = resolve({
      feature: 'text',
      flagModel: 'custom-model',
      env: { MORPHIX_TEXT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk' },
      config: cfg(),
    })
    expect(r.provider).toBe('openai')
    expect(r.model).toBe('custom-model')
  })
})

describe('resolver errors', () => {
  it('throws MissingProvider when nothing set', () => {
    const empty = cfg({
      defaults: {
        image: {},
        text: {},
        video: {},
        speech: {},
        music: {},
        vision: {},
        search: {},
      },
    })
    expect(() =>
      resolve({ feature: 'text', env: {}, config: empty }),
    ).toThrow(MissingProviderError)
  })

  it('throws MissingModel when provider is set but no model anywhere', () => {
    // Clear the music default explicitly so the last-resort PROVIDER_DEFAULT_MODELS
    // lookup for anthropic.music (which is undefined) is what resolves.
    const noModel = cfg({ defaults: { music: {} } })
    const r = () =>
      resolve({
        feature: 'music',
        flagProvider: 'anthropic',
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        config: noModel,
      })
    expect(r).toThrow(MissingModelError)
  })

  it('throws MissingCredential for cloud provider without key', () => {
    expect(() =>
      resolve({ feature: 'text', flagProvider: 'anthropic', env: {}, config: cfg() }),
    ).toThrow(MissingCredentialError)
  })

  it('does NOT require API key for local providers', () => {
    const r = resolve({
      feature: 'text',
      flagProvider: 'ollama',
      env: {},
      config: cfg(),
    })
    expect(r.provider).toBe('ollama')
    expect(r.providerConfig.endpoint).toBe('http://localhost:11434')
  })

  it('env OLLAMA_HOST overrides config endpoint', () => {
    const r = resolve({
      feature: 'text',
      flagProvider: 'ollama',
      env: { OLLAMA_HOST: 'http://remote:11434' },
      config: cfg(),
    })
    expect(r.providerConfig.endpoint).toBe('http://remote:11434')
  })

  it('hint message references env var and auth command', () => {
    try {
      resolve({ feature: 'text', flagProvider: 'openai', env: {}, config: cfg() })
      expect.fail('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(MissingCredentialError)
      expect((e as MissingCredentialError).hint).toMatch(/OPENAI_API_KEY/)
      expect((e as MissingCredentialError).hint).toMatch(/mx auth login --provider openai/)
    }
  })
})
