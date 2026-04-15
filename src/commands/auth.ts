import { createInterface, Interface } from 'node:readline/promises'
import { parseArgs, getString } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { maskSecret, removeCredential, saveCredential } from '../auth/keystore.js'
import { needsApiKey, isProviderId } from '../config/schema.js'
import { providerConfigFromEnv } from '../config/env.js'
import { emitResult, type RunContext } from '../utils/envelope.js'
import { CommandSpec } from './spec.js'

export const spec: CommandSpec = {
  name: 'auth',
  summary: 'Manage provider credentials.',
  subcommands: [
    {
      name: 'login',
      summary: 'Save credentials for a provider.',
      flags: [
        { name: 'provider', type: 'string', required: true, enum: ['anthropic', 'openai', 'gemini', 'ollama', 'comfyui', 'piapi', 'typecast'], description: 'Provider id.' },
        { name: 'api-key', type: 'string', description: 'API key (or "-" to read from stdin).' },
        { name: 'endpoint', type: 'string', description: 'Endpoint URL (for endpoint-only providers).' },
      ],
      outputs: [
        { kind: 'text', description: 'Path of saved credentials file.' },
        { kind: 'json', description: '{ provider, path, source }' },
      ],
    },
    {
      name: 'logout',
      summary: 'Remove credentials for a provider.',
      flags: [{ name: 'provider', type: 'string', required: true, description: 'Provider id.' }],
    },
    {
      name: 'status',
      summary: 'Show masked credentials and their source (env|file|none).',
      outputs: [{ kind: 'json', description: 'Array of {provider, ready, source, key?, endpoint?}' }],
    },
  ],
}

export async function authCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  switch (sub) {
    case 'login':
      await doLogin(flags, ctx)
      return
    case 'logout':
      await doLogout(flags, ctx)
      return
    case 'status':
      await doStatus(ctx)
      return
    default:
      throw new MorphixError(`Unknown 'auth' subcommand: '${sub}'`, {
        code: 'E_BAD_SUBCMD',
        exitCode: 64,
        hint: `Available: login, logout, status`,
      })
  }
}

async function doLogin(flags: Record<string, unknown>, ctx: RunContext): Promise<void> {
  const provider = getString(flags as Parameters<typeof getString>[0], 'provider')
  if (!provider) {
    throw new MorphixError(`--provider is required.`, {
      code: 'E_BAD_ARGS',
      exitCode: 64,
      hint: `mx auth login --provider <anthropic|openai|gemini|ollama|comfyui>`,
    })
  }
  if (!isProviderId(provider)) {
    throw new MorphixError(`Unknown provider: '${provider}'`, {
      code: 'E_BAD_PROVIDER',
      exitCode: 64,
      hint: `Valid: anthropic, openai, gemini, ollama, comfyui`,
    })
  }

  const flagApiKey = getString(flags as Parameters<typeof getString>[0], 'api-key')
  const flagEndpoint = getString(flags as Parameters<typeof getString>[0], 'endpoint')

  const wantsKey = needsApiKey(provider)
  const haveAll = wantsKey ? flagApiKey !== undefined : flagEndpoint !== undefined

  // In non-interactive mode (TTY missing or --non-interactive), refuse to
  // prompt. The agent must supply --api-key/--endpoint, optionally with "-"
  // to read the value from stdin.
  if (!haveAll && ctx.nonInteractive) {
    throw new MorphixError(
      `Cannot prompt for ${wantsKey ? 'API key' : 'endpoint'} in non-interactive mode.`,
      {
        code: 'E_INTERACTIVE_REQUIRED',
        exitCode: 64,
        hint: wantsKey
          ? `Pass --api-key <KEY> (or --api-key - to read from stdin).`
          : `Pass --endpoint <URL>.`,
      },
    )
  }

  let path: string
  if (wantsKey) {
    let key = flagApiKey
    if (key === '-') key = (await readStdin()).trim()
    if (!key) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        key = await promptHidden(rl, `API key for ${provider}: `)
      } finally {
        rl.close()
      }
    }
    if (!key) {
      throw new MorphixError(`Empty API key.`, { code: 'E_BAD_ARGS', exitCode: 64 })
    }
    path = await saveCredential(provider, { apiKey: key })
  } else {
    let endpoint = flagEndpoint
    if (endpoint === '-') endpoint = (await readStdin()).trim()
    if (!endpoint) {
      const defaults: Record<string, string> = {
        ollama: 'http://localhost:11434',
        comfyui: 'http://localhost:8188',
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        endpoint =
          (await rl.question(`Endpoint for ${provider} [${defaults[provider]}]: `)) ||
          defaults[provider]
      } finally {
        rl.close()
      }
    }
    path = await saveCredential(provider, { endpoint })
  }

  if (ctx.json) {
    emitResult(ctx, 'auth.login', { provider, path })
  } else {
    console.log(`Saved ${provider} credentials to ${path}`)
  }
}

async function doLogout(flags: Record<string, unknown>, ctx: RunContext): Promise<void> {
  const provider = getString(flags as Parameters<typeof getString>[0], 'provider')
  if (!provider) {
    throw new MorphixError(`--provider is required.`, {
      code: 'E_BAD_ARGS',
      exitCode: 64,
      hint: `mx auth logout --provider <id>`,
    })
  }
  const path = await removeCredential(provider)
  if (ctx.json) emitResult(ctx, 'auth.logout', { provider, path })
  else console.log(`Removed ${provider} credentials from ${path}`)
}

async function doStatus(ctx: RunContext): Promise<void> {
  const config = await loadConfig()
  const providers = ['anthropic', 'openai', 'gemini', 'ollama', 'comfyui']
  const rows: Array<Record<string, unknown>> = []
  for (const id of providers) {
    const fileCfg = config.providers[id] ?? {}
    const envCfg = providerConfigFromEnv(id)
    const apiKey = envCfg.apiKey ?? fileCfg.apiKey
    const endpoint = envCfg.endpoint ?? fileCfg.endpoint
    const source = envCfg.apiKey || envCfg.endpoint ? 'env' : fileCfg.apiKey || fileCfg.endpoint ? 'file' : 'none'
    if (needsApiKey(id)) {
      rows.push({ provider: id, ready: !!apiKey, key: maskSecret(apiKey), source })
    } else {
      rows.push({ provider: id, ready: !!endpoint, endpoint: endpoint ?? null, source })
    }
  }
  if (ctx.json) {
    emitResult(ctx, 'auth.status', rows)
    return
  }
  console.log('Provider credentials (file + env merged):\n')
  for (const r of rows) {
    if ('key' in r) {
      console.log(`  ${(r.provider as string).padEnd(10)}  key=${r.key}  (source: ${r.source})`)
    } else {
      console.log(`  ${(r.provider as string).padEnd(10)}  endpoint=${r.endpoint ?? '(not set)'}  (source: ${r.source})`)
    }
  }
}

async function promptHidden(rl: Interface, prompt: string): Promise<string> {
  const stdin = process.stdin
  if (!stdin.isTTY) {
    return (await rl.question(prompt)).trim()
  }
  process.stdout.write(prompt)
  const originalWrite = (process.stdout as unknown as { write: (s: string) => boolean }).write.bind(
    process.stdout,
  )
  ;(process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    if (s && s !== prompt && s !== '\n' && s !== '\r\n') return true
    return originalWrite(s)
  }
  try {
    const answer = await rl.question('')
    process.stdout.write('\n')
    return answer.trim()
  } finally {
    ;(process.stdout as unknown as { write: (s: string) => boolean }).write = originalWrite
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function printHelp(): void {
  console.log(`Usage: mx auth <login|logout|status> [options]

  login   --provider <id> [--api-key <k|->] [--endpoint <url>]
          Stores credentials in ~/.morphix/config.json (chmod 0600).
          With --api-key - reads the key from stdin (no TTY needed).
  logout  --provider <id>
          Removes that provider's credential block.
  status
          Show masked keys / endpoints and whether they come from env or file.

  --non-interactive          Refuse to prompt. Required values must come from
                             flags or stdin.
`)
}
