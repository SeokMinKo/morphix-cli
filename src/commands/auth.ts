import { createInterface, Interface } from 'node:readline/promises'
import { parseArgs, getString } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { maskSecret, removeCredential, saveCredential } from '../auth/keystore.js'
import { needsApiKey, isProviderId } from '../config/schema.js'
import { providerConfigFromEnv } from '../config/env.js'

export async function authCommand(argv: string[]): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  switch (sub) {
    case 'login':
      await doLogin(flags)
      return
    case 'logout':
      await doLogout(flags)
      return
    case 'status':
      await doStatus()
      return
    default:
      throw new MorphixError(`Unknown 'auth' subcommand: '${sub}'`, {
        code: 'E_BAD_SUBCMD',
        exitCode: 64,
        hint: `Available: login, logout, status`,
      })
  }
}

async function doLogin(flags: Record<string, unknown>): Promise<void> {
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

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    let path: string
    if (needsApiKey(provider)) {
      const flagKey = getString(flags as Parameters<typeof getString>[0], 'api-key')
      const key = flagKey ?? (await promptHidden(rl, `API key for ${provider}: `))
      if (!key) {
        throw new MorphixError(`Empty API key.`, { code: 'E_BAD_ARGS', exitCode: 64 })
      }
      path = await saveCredential(provider, { apiKey: key })
    } else {
      const flagEndpoint = getString(flags as Parameters<typeof getString>[0], 'endpoint')
      const defaults: Record<string, string> = {
        ollama: 'http://localhost:11434',
        comfyui: 'http://localhost:8188',
      }
      const endpoint =
        flagEndpoint ??
        ((await rl.question(`Endpoint for ${provider} [${defaults[provider]}]: `)) ||
          defaults[provider])
      path = await saveCredential(provider, { endpoint })
    }
    console.log(`Saved ${provider} credentials to ${path}`)
  } finally {
    rl.close()
  }
}

async function doLogout(flags: Record<string, unknown>): Promise<void> {
  const provider = getString(flags as Parameters<typeof getString>[0], 'provider')
  if (!provider) {
    throw new MorphixError(`--provider is required.`, {
      code: 'E_BAD_ARGS',
      exitCode: 64,
      hint: `mx auth logout --provider <id>`,
    })
  }
  const path = await removeCredential(provider)
  console.log(`Removed ${provider} credentials from ${path}`)
}

async function doStatus(): Promise<void> {
  const config = await loadConfig()
  const providers = ['anthropic', 'openai', 'gemini', 'ollama', 'comfyui']
  console.log('Provider credentials (file + env merged):\n')
  for (const id of providers) {
    const fileCfg = config.providers[id] ?? {}
    const envCfg = providerConfigFromEnv(id)
    const apiKey = envCfg.apiKey ?? fileCfg.apiKey
    const endpoint = envCfg.endpoint ?? fileCfg.endpoint
    const source = envCfg.apiKey || envCfg.endpoint ? 'env' : fileCfg.apiKey || fileCfg.endpoint ? 'file' : 'none'
    if (needsApiKey(id)) {
      console.log(`  ${id.padEnd(10)}  key=${maskSecret(apiKey)}  (source: ${source})`)
    } else {
      console.log(`  ${id.padEnd(10)}  endpoint=${endpoint ?? '(not set)'}  (source: ${source})`)
    }
  }
}

/**
 * Read a line without echoing (best-effort for TTY). Falls back to plain
 * readline if stdin isn't a TTY (e.g. piped input).
 */
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

function printHelp(): void {
  console.log(`Usage: mx auth <login|logout|status> [options]

  login   --provider <id> [--api-key <k>] [--endpoint <url>]
          Stores credentials in ~/.morphix/config.json (chmod 0600).
  logout  --provider <id>
          Removes that provider's credential block.
  status
          Show masked keys / endpoints and whether they come from env or file.
`)
}
