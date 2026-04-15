import { createWriteStream } from 'node:fs'
import { parseArgs, getString, getNumber } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'

export async function speechCommand(argv: string[]): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  registerBuiltins()

  if (sub === 'voices') {
    return doVoices(flags)
  }
  if (sub !== 'synthesize' && sub !== 'say') {
    throw new MorphixError(`Unknown 'speech' subcommand: '${sub}'`, {
      code: 'E_BAD_SUBCMD',
      exitCode: 64,
      hint: `Available: synthesize, voices`,
    })
  }

  const text = getString(flags, 'text', 't')
  if (!text) {
    throw new MorphixError(`--text is required.`, { code: 'E_NO_INPUT', exitCode: 64 })
  }
  const outPath = getString(flags, 'output', 'out')
  if (!outPath) {
    throw new MorphixError(`--out is required.`, {
      code: 'E_NO_INPUT',
      exitCode: 64,
      hint: `mx speech synthesize --text "..." --out hello.mp3`,
    })
  }

  const config = await loadConfig()
  const resolved = resolve({
    feature: 'speech',
    flagProvider: getString(flags, 'provider'),
    flagModel: getString(flags, 'model'),
    config,
  })
  const { impl } = getCapability('speech', resolved.provider, resolved.providerConfig)

  const format = inferFormat(outPath)
  const stream = impl.synthesize(
    {
      text,
      voice: getString(flags, 'voice'),
      speed: getNumber(flags, 'speed'),
    },
    { model: resolved.model, format },
  )
  const ws = createWriteStream(outPath)
  for await (const chunk of stream) ws.write(chunk)
  ws.end()
  console.log(outPath)
}

function inferFormat(path: string): 'mp3' | 'wav' | 'opus' | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'mp3' || ext === 'wav' || ext === 'opus') return ext
  return undefined
}

async function doVoices(flags: Record<string, unknown>): Promise<void> {
  const config = await loadConfig()
  const resolved = resolve({
    feature: 'speech',
    flagProvider: getString(flags as Parameters<typeof getString>[0], 'provider'),
    flagModel: getString(flags as Parameters<typeof getString>[0], 'model'),
    config,
  })
  const { impl } = getCapability('speech', resolved.provider, resolved.providerConfig)
  if (!impl.voices) {
    throw new MorphixError(`Provider '${resolved.provider}' does not expose a voice list.`, {
      code: 'E_UNSUPPORTED',
      exitCode: 64,
    })
  }
  const voices = await impl.voices()
  console.log(JSON.stringify(voices, null, 2))
}

function printHelp(): void {
  console.log(`Usage: mx speech <synthesize|voices> [options]

  synthesize --text <t> --out <path> [--voice <id>] [--speed <n>]
  voices                     List available voices for the provider.

  --provider <id>            openai | gemini
  --model <name>             Provider-specific model id.
`)
}
