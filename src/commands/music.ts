import { parseArgs, getString, getBool, getNumber } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'
import { writeBytes } from '../utils/fs.js'

export async function musicCommand(argv: string[]): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  if (sub !== 'generate' && sub !== 'gen') {
    throw new MorphixError(`Unknown 'music' subcommand: '${sub}'`, {
      code: 'E_BAD_SUBCMD',
      exitCode: 64,
      hint: `Available: generate`,
    })
  }

  registerBuiltins()

  const prompt = getString(flags, 'prompt', 'p')
  if (!prompt) throw new MorphixError(`--prompt is required.`, { code: 'E_NO_INPUT', exitCode: 64 })
  const outPath = getString(flags, 'output', 'out')
  if (!outPath) throw new MorphixError(`--out is required.`, { code: 'E_NO_INPUT', exitCode: 64 })

  const config = await loadConfig()
  const resolved = resolve({
    feature: 'music',
    flagProvider: getString(flags, 'provider'),
    flagModel: getString(flags, 'model'),
    config,
  })
  const { impl } = getCapability('music', resolved.provider, resolved.providerConfig)

  const result = await impl.generate(
    {
      prompt,
      lyrics: getString(flags, 'lyrics'),
      instrumental: getBool(flags, 'instrumental'),
      durationSec: getNumber(flags, 'duration'),
      genre: getString(flags, 'genre'),
    },
    { model: resolved.model },
  )
  if (result.kind === 'async') {
    console.log(JSON.stringify({ jobId: result.jobId, provider: resolved.provider }))
    return
  }
  for (const asset of result.assets) {
    if (asset.bytes) {
      const saved = await writeBytes(outPath, asset.bytes)
      console.log(saved)
    } else if (asset.url) {
      console.log(asset.url)
    }
  }
}

function printHelp(): void {
  console.log(`Usage: mx music generate [options]

  --prompt, -p <text>        Prompt describing the music.
  --lyrics <text>            Optional lyrics.
  --instrumental             Instrumental only (no vocals).
  --genre <name>             e.g. "indie rock", "orchestral".
  --duration <sec>           Track length in seconds.
  --out <path>               Output file.
  --provider <id>            comfyui
  --model <name>             Provider-specific model id.
`)
}
