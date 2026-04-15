import { homedir } from 'node:os'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Expand a leading `~` in a path to the user's home directory. */
export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

/** Resolve a path, expanding `~` and making it absolute. */
export function resolvePath(p: string): string {
  const expanded = expandHome(p)
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded)
}

/** Ensure the directory exists (recursive mkdir). Returns the resolved path. */
export async function ensureDir(p: string, mode: number = 0o755): Promise<string> {
  const full = resolvePath(p)
  await mkdir(full, { recursive: true, mode })
  return full
}

/** Write bytes to a file, creating parent directories. Returns the resolved path. */
export async function writeBytes(
  p: string,
  bytes: Uint8Array,
  opts: { mode?: number } = {},
): Promise<string> {
  const full = resolvePath(p)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, bytes, { mode: opts.mode })
  return full
}
