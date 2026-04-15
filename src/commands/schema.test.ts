import { describe, expect, it } from 'vitest'
import { listCommand, schemaCommand } from './schema.js'
import { defaultRunContext } from '../utils/envelope.js'
import { CAPABILITIES, PROVIDER_IDS } from '../config/schema.js'

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

describe('mx schema', () => {
  it('emits a JSON manifest containing every command, provider, capability, and error code', async () => {
    const ctx = { ...defaultRunContext(), json: true }
    const out = await captureStdout(() => schemaCommand([], ctx))
    const env = JSON.parse(out.trim())
    expect(env.ok).toBe(true)
    const data = env.data
    const names = data.commands.map((c: { name: string }) => c.name)
    for (const required of ['text', 'image', 'video', 'speech', 'music', 'vision', 'search', 'auth', 'config', 'quota', 'schema', 'list', 'update']) {
      expect(names).toContain(required)
    }
    expect(data.providers.map((p: { id: string }) => p.id).sort()).toEqual([...PROVIDER_IDS].sort())
    expect(data.capabilities).toEqual([...CAPABILITIES])
    expect(Array.isArray(data.errorCodes)).toBe(true)
    expect(data.errorCodes.find((e: { code: string }) => e.code === 'E_NO_PROVIDER')).toBeTruthy()
    expect(data.errorCodes.find((e: { code: string }) => e.code === 'E_INTERACTIVE_REQUIRED')).toBeTruthy()
  })

  it('exposes the music.cover subcommand on the music spec', async () => {
    const ctx = { ...defaultRunContext(), json: true }
    const out = await captureStdout(() => schemaCommand([], ctx))
    const env = JSON.parse(out.trim())
    const music = env.data.commands.find((c: { name: string }) => c.name === 'music')
    const subnames = music.subcommands.map((s: { name: string }) => s.name)
    expect(subnames).toContain('cover')
  })
})

describe('mx list', () => {
  it('lists providers in JSON', async () => {
    const ctx = { ...defaultRunContext(), json: true }
    const out = await captureStdout(() => listCommand(['providers'], ctx))
    const env = JSON.parse(out.trim())
    expect(env.command).toBe('list.providers')
    expect(env.data.length).toBe(PROVIDER_IDS.length)
  })

  it('filters models by --provider', async () => {
    const ctx = { ...defaultRunContext(), json: true }
    const out = await captureStdout(() => listCommand(['models', '--provider', 'openai'], ctx))
    const env = JSON.parse(out.trim())
    expect(env.data.every((r: { provider: string }) => r.provider === 'openai')).toBe(true)
    const caps = env.data.map((r: { capability: string }) => r.capability)
    expect(caps).toContain('image')
    expect(caps).toContain('text')
  })

  it('lists capabilities in JSON', async () => {
    const ctx = { ...defaultRunContext(), json: true }
    const out = await captureStdout(() => listCommand(['capabilities'], ctx))
    const env = JSON.parse(out.trim())
    expect(env.data).toEqual([...CAPABILITIES])
  })
})
