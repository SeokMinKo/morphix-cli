/**
 * `mx update` — thin wrapper around the global package manager to reinstall
 * morphix-cli at @latest. Does NOT self-modify; only exec's the appropriate
 * `<npm|pnpm|yarn|bun> <install-g> morphix-cli@latest`.
 */
import { spawn } from 'node:child_process'
import { parseArgs, getString, getBool } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import type { RunContext } from '../utils/envelope.js'
import { emitResult } from '../utils/envelope.js'
import { CommandSpec } from './spec.js'

export const spec: CommandSpec = {
  name: 'update',
  summary: 'Reinstall morphix-cli globally at the latest version.',
  flags: [
    {
      name: 'manager',
      type: 'string',
      description: 'Force a package manager.',
      enum: ['npm', 'pnpm', 'yarn', 'bun'],
    },
    {
      name: 'tag',
      type: 'string',
      description: 'npm dist-tag to install (default: latest).',
      default: 'latest',
    },
    {
      name: 'dry-run',
      type: 'boolean',
      description: 'Print the command that would be run and exit.',
    },
  ],
  outputs: [
    { kind: 'stream', description: 'Subprocess stdout/stderr passthrough (human mode).' },
    { kind: 'json', description: '{ manager, from, to, command }', shape: '{manager,from,to,command,ok}' },
  ],
  examples: ['mx update', 'mx update --manager pnpm --json'],
}

function detectManager(explicit?: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (explicit === 'npm' || explicit === 'pnpm' || explicit === 'yarn' || explicit === 'bun') {
    return explicit
  }
  const ua = process.env.npm_config_user_agent ?? ''
  if (ua.startsWith('pnpm')) return 'pnpm'
  if (ua.startsWith('yarn')) return 'yarn'
  if (ua.startsWith('bun')) return 'bun'
  return 'npm'
}

function installCommand(manager: 'npm' | 'pnpm' | 'yarn' | 'bun', tag: string): string[] {
  const pkg = `morphix-cli@${tag}`
  switch (manager) {
    case 'npm':
      return ['npm', 'install', '-g', pkg]
    case 'pnpm':
      return ['pnpm', 'add', '-g', pkg]
    case 'yarn':
      return ['yarn', 'global', 'add', pkg]
    case 'bun':
      return ['bun', 'add', '-g', pkg]
  }
}

export async function updateCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { flags } = parseArgs(argv)
  if (flags.help) {
    printHelp()
    return
  }
  const manager = detectManager(getString(flags, 'manager'))
  const tag = getString(flags, 'tag') ?? 'latest'
  const dryRun = getBool(flags, 'dry-run')
  const [cmd, ...args] = installCommand(manager, tag)
  const fromVersion = readLocalVersion()

  if (dryRun) {
    const command = [cmd, ...args].join(' ')
    if (ctx.json) emitResult(ctx, 'update', { manager, from: fromVersion, command, dryRun: true })
    else console.log(command)
    return
  }

  const code = await runPassthrough(cmd, args, ctx)
  if (code !== 0) {
    throw new MorphixError(`${manager} exited with code ${code}.`, {
      code: 'E_UPDATE_FAILED',
      exitCode: 70,
      hint: `Try rerunning with --manager <npm|pnpm|yarn|bun> or check network access.`,
    })
  }
  if (ctx.json) {
    emitResult(ctx, 'update', {
      manager,
      from: fromVersion,
      to: tag,
      command: [cmd, ...args].join(' '),
    })
  } else {
    console.log(`morphix-cli reinstalled via ${manager} (${tag}).`)
  }
}

function runPassthrough(
  cmd: string,
  args: string[],
  ctx: RunContext,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      // In JSON mode suppress subprocess stdout so the envelope is the only
      // JSON on stdout; errors still go to stderr for visibility.
      stdio: ctx.json ? ['ignore', 'ignore', 'inherit'] : 'inherit',
    })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 0))
  })
}

function readLocalVersion(): string {
  try {
    // The CLI's own version — hardcoded in package.json; we surface what we
    // know at runtime from the tag we ship in index.ts.
    return '0.1.0'
  } catch {
    return 'unknown'
  }
}

function printHelp(): void {
  console.log(`Usage: mx update [options]

  Reinstall morphix-cli globally via npm/pnpm/yarn/bun (auto-detected).

  --manager <npm|pnpm|yarn|bun>   Force a package manager.
  --tag <dist-tag>                npm dist-tag (default: latest).
  --dry-run                       Print the command without running it.
  --json                          Emit a JSON envelope.
`)
}
