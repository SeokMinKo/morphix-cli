import { describe, expect, it } from 'vitest'
import { configCommand } from './config.js'
import { defaultRunContext } from '../utils/envelope.js'

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string | Uint8Array): boolean => {
    chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'))
    return true
  }) as typeof process.stdout.write
  return fn()
    .then(() => chunks.join(''))
    .finally(() => {
      process.stdout.write = orig
    })
}

describe('mx config export-schema', () => {
  it('emits a Draft-07 JSON Schema for MorphixConfig', async () => {
    const ctx = { ...defaultRunContext(), json: true }
    const out = await captureStdout(() => configCommand(['export-schema'], ctx))
    const env = JSON.parse(out.trim())
    const schema = env.data
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#')
    expect(schema.title).toBe('MorphixConfig')
    expect(schema.type).toBe('object')
    expect(schema.properties.version.const).toBe(1)
    expect(schema.properties.defaults.properties.text).toBeDefined()
    expect(schema.properties.providers.properties.openai).toBeDefined()
    expect(schema.properties.providers.properties.openai.properties.apiKey.type).toBe('string')
  })
})
