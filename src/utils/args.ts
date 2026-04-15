export type FlagValue = string | boolean

export interface ParsedArgs {
  command: string | undefined
  args: string[]
  flags: Record<string, FlagValue | FlagValue[]>
}

/**
 * Parse CLI argv into { command, args, flags }.
 *
 * Supports:
 *  - `--key=value` and `--key value` and `--flag`
 *  - `-h`, `-v` shortcuts
 *  - Repeated flags (e.g. `--message a --message b`) collected into an array
 *  - `--` terminator after which everything is positional
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, FlagValue | FlagValue[]> = {}
  const positional: string[] = []

  let i = 0
  let passthrough = false

  while (i < argv.length) {
    const arg = argv[i]

    if (passthrough) {
      positional.push(arg)
      i++
      continue
    }

    if (arg === '--') {
      passthrough = true
      i++
      continue
    }

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      let key: string
      let value: FlagValue
      if (eq >= 0) {
        key = arg.slice(2, eq)
        value = arg.slice(eq + 1)
      } else {
        key = arg.slice(2)
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('-')) {
          value = next
          i++
        } else {
          value = true
        }
      }
      assignFlag(flags, key, value)
    } else if (arg.startsWith('-') && arg.length > 1) {
      const key = arg.slice(1)
      if (key === 'h') {
        assignFlag(flags, 'help', true)
      } else if (key === 'v') {
        assignFlag(flags, 'version', true)
      } else {
        // Short flag with optional value: `-m foo` → value, else boolean.
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('-')) {
          assignFlag(flags, key, next)
          i++
        } else {
          assignFlag(flags, key, true)
        }
      }
    } else {
      positional.push(arg)
    }

    i++
  }

  return {
    command: positional[0],
    args: positional.slice(1),
    flags,
  }
}

function assignFlag(
  flags: Record<string, FlagValue | FlagValue[]>,
  key: string,
  value: FlagValue,
): void {
  const existing = flags[key]
  if (existing === undefined) {
    flags[key] = value
  } else if (Array.isArray(existing)) {
    existing.push(value)
  } else {
    flags[key] = [existing, value]
  }
}

/** Get a flag as string. Returns undefined if missing or purely boolean. */
export function getString(
  flags: Record<string, FlagValue | FlagValue[]>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const v = flags[name]
    if (typeof v === 'string') return v
    if (Array.isArray(v)) {
      const last = v[v.length - 1]
      if (typeof last === 'string') return last
    }
  }
  return undefined
}

/** Get a flag as boolean. Missing → false. String "false"/"0" → false. */
export function getBool(
  flags: Record<string, FlagValue | FlagValue[]>,
  ...names: string[]
): boolean {
  for (const name of names) {
    const v = flags[name]
    if (v === undefined) continue
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') {
      if (v === 'false' || v === '0' || v === 'no') return false
      return true
    }
    if (Array.isArray(v)) {
      const last = v[v.length - 1]
      if (typeof last === 'boolean') return last
      if (typeof last === 'string') return last !== 'false' && last !== '0' && last !== 'no'
    }
  }
  return false
}

/** Collect a flag as string array (for repeated flags like --message). */
export function getStrings(
  flags: Record<string, FlagValue | FlagValue[]>,
  ...names: string[]
): string[] {
  const out: string[] = []
  for (const name of names) {
    const v = flags[name]
    if (v === undefined) continue
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) {
      for (const item of v) if (typeof item === 'string') out.push(item)
    }
  }
  return out
}

/** Parse a flag as integer. Returns fallback if missing/NaN. */
export function getNumber(
  flags: Record<string, FlagValue | FlagValue[]>,
  name: string,
  fallback?: number,
): number | undefined {
  const s = getString(flags, name)
  if (s === undefined) return fallback
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}
