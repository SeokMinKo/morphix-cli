import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { MorphixConfig, DEFAULT_CONFIG } from './schema.js'

/** Default location of the persisted config file. */
export function configPath(): string {
  return process.env.MORPHIX_CONFIG ?? join(homedir(), '.morphix', 'config.json')
}

/**
 * Load config from disk, falling back to DEFAULT_CONFIG if the file is
 * missing or malformed. Returns a fresh copy — safe to mutate.
 */
export async function loadConfig(): Promise<MorphixConfig> {
  const path = configPath()
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<MorphixConfig>
    return mergeWithDefaults(parsed)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(DEFAULT_CONFIG)
    }
    // Malformed JSON: fall back to defaults rather than crash. The user can
    // inspect with `mx config path` and fix manually.
    if (err instanceof SyntaxError) {
      return structuredClone(DEFAULT_CONFIG)
    }
    throw err
  }
}

/**
 * Persist config to disk with tight permissions (dir 0700, file 0600) so
 * any credentials stored inside are not world-readable.
 */
export async function saveConfig(config: MorphixConfig): Promise<string> {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const json = JSON.stringify(config, null, 2) + '\n'
  await writeFile(path, json, { mode: 0o600 })
  // Best-effort chmod in case the file already existed with looser perms.
  try {
    await chmod(path, 0o600)
    await chmod(dirname(path), 0o700)
  } catch {
    // non-fatal (e.g. Windows)
  }
  return path
}

function mergeWithDefaults(partial: Partial<MorphixConfig>): MorphixConfig {
  const base = structuredClone(DEFAULT_CONFIG)
  if (!partial || typeof partial !== 'object') return base
  if (partial.version) base.version = partial.version
  if (partial.outputDir) base.outputDir = partial.outputDir
  if (partial.defaults) {
    base.defaults = { ...base.defaults, ...partial.defaults }
  }
  if (partial.providers) {
    // Do not inherit defaults for providers — user-configured providers should
    // replace, not merge with, built-in endpoint defaults. But for known local
    // providers we still want the endpoint fallback if the user omitted it.
    base.providers = { ...base.providers, ...partial.providers }
  }
  return base
}

/**
 * Set a nested config value by dot-path. Supports keys like:
 *   - `defaults.text.provider`
 *   - `defaults.text.model`
 *   - `providers.anthropic.apiKey`
 *   - `providers.ollama.endpoint`
 *   - `outputDir`
 */
export function setByPath(config: MorphixConfig, path: string, value: string): void {
  const parts = path.split('.')
  if (parts.length === 0) throw new Error(`Empty config key`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = config
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (node[k] === undefined || node[k] === null || typeof node[k] !== 'object') {
      node[k] = {}
    }
    node = node[k]
  }
  node[parts[parts.length - 1]] = value
}
