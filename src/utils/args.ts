export interface ParsedArgs {
  command: string | undefined
  args: string[]
  flags: Record<string, boolean | string>
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, boolean | string> = {}
  const positional: string[] = []

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=')
      flags[key] = value ?? true
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1)
      if (key === 'h') flags.help = true
      else if (key === 'v') flags.version = true
      else flags[key] = true
    } else {
      positional.push(arg)
    }
  }

  return {
    command: positional[0],
    args: positional.slice(1),
    flags,
  }
}
