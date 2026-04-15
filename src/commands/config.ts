import { parseArgs, getString } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { configPath, loadConfig, loadRawConfig, saveConfig, setByPath } from '../config/file.js'
import { maskSecret } from '../auth/keystore.js'

export async function configCommand(argv: string[]): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  switch (sub) {
    case 'show':
      await doShow()
      return
    case 'set':
      await doSet(flags)
      return
    case 'path':
      console.log(configPath())
      return
    default:
      throw new MorphixError(`Unknown 'config' subcommand: '${sub}'`, {
        code: 'E_BAD_SUBCMD',
        exitCode: 64,
        hint: `Available: show, set, path`,
      })
  }
}

async function doShow(): Promise<void> {
  const config = await loadConfig()
  // Redact any credentials before printing.
  const clone = structuredClone(config)
  for (const id of Object.keys(clone.providers)) {
    const p = clone.providers[id]
    if (p?.apiKey) p.apiKey = maskSecret(p.apiKey)
  }
  console.log(JSON.stringify(clone, null, 2))
}

async function doSet(flags: Record<string, unknown>): Promise<void> {
  const key = getString(flags as Parameters<typeof getString>[0], 'key')
  const value = getString(flags as Parameters<typeof getString>[0], 'value')
  if (!key || value === undefined) {
    throw new MorphixError(`--key and --value are required.`, {
      code: 'E_BAD_ARGS',
      exitCode: 64,
      hint:
        `Examples:\n` +
        `  mx config set --key defaults.text.provider --value openai\n` +
        `  mx config set --key defaults.video.model --value veo-3.0\n` +
        `  mx config set --key providers.ollama.endpoint --value http://localhost:11434`,
    })
  }
  // Mutate the raw on-disk config (NOT the merged-with-defaults one) so that
  // we persist only user-specified values. Saving the merged config would
  // bake the current CLI defaults into the file and prevent future upgrades
  // from changing them.
  const raw = await loadRawConfig()
  setByPath(raw, key, value)
  const path = await saveConfig(raw)
  console.log(`Set ${key} = ${key.includes('apiKey') ? '(hidden)' : value}`)
  console.log(`  in ${path}`)
}

function printHelp(): void {
  console.log(`Usage: mx config <show|set|path> [options]

  show                       Print the merged config (secrets are masked).
  set --key <path> --value <v>
                             Set a dot-path value. Examples:
                               defaults.<feature>.provider
                               defaults.<feature>.model
                               providers.<id>.endpoint
                               providers.<id>.apiKey
                               outputDir
  path                       Print the path to the config file.
`)
}
