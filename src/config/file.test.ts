import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, loadRawConfig, saveConfig, setByPath } from './file.js'
import { DEFAULT_CONFIG } from './schema.js'

describe('config file layer', () => {
  let dir: string
  let path: string
  const prevEnv = process.env.MORPHIX_CONFIG

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'morphix-cfg-'))
    path = join(dir, 'config.json')
    process.env.MORPHIX_CONFIG = path
  })

  afterEach(async () => {
    process.env.MORPHIX_CONFIG = prevEnv
    await rm(dir, { recursive: true, force: true })
  })

  it('loadConfig returns defaults when file missing', async () => {
    const cfg = await loadConfig()
    expect(cfg.defaults.text?.provider).toBe(DEFAULT_CONFIG.defaults.text?.provider)
  })

  it('per-provider shallow merge preserves default endpoints', async () => {
    // User sets only an apiKey on ollama; the default endpoint must survive.
    await writeFile(
      path,
      JSON.stringify({ providers: { ollama: { apiKey: 'xyz' } } }),
    )
    const cfg = await loadConfig()
    expect(cfg.providers.ollama?.apiKey).toBe('xyz')
    expect(cfg.providers.ollama?.endpoint).toBe('http://localhost:11434')
  })

  it('loadRawConfig returns the on-disk partial without defaults', async () => {
    await writeFile(path, JSON.stringify({ outputDir: '~/custom' }))
    const raw = await loadRawConfig()
    expect(raw).toEqual({ outputDir: '~/custom' })
    // Crucially: raw does NOT include baked-in defaults.
    expect(raw.defaults).toBeUndefined()
    expect(raw.providers).toBeUndefined()
  })

  it('saveConfig(raw) + setByPath only persists user-set values', async () => {
    const raw = await loadRawConfig()
    setByPath(raw, 'defaults.text.model', 'claude-sonnet-4-5-20250929')
    await saveConfig(raw)
    const onDisk = JSON.parse(await readFile(path, 'utf8'))
    // Only the key we set should be present — no bake-in of other defaults.
    expect(onDisk).toEqual({
      defaults: { text: { model: 'claude-sonnet-4-5-20250929' } },
    })
  })

  it('gracefully handles malformed JSON on disk', async () => {
    await writeFile(path, '{not json')
    const cfg = await loadConfig()
    // Falls back to defaults rather than crash.
    expect(cfg.version).toBe(DEFAULT_CONFIG.version)
  })
})
