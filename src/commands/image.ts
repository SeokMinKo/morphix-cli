import { parseArgs, getString, getNumber } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'
import { writeBytes } from '../utils/fs.js'
import { join } from 'node:path'

export async function imageCommand(argv: string[]): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  if (sub !== 'generate' && sub !== 'gen') {
    throw new MorphixError(`Unknown 'image' subcommand: '${sub}'`, {
      code: 'E_BAD_SUBCMD',
      exitCode: 64,
      hint: `Available: generate`,
    })
  }

  registerBuiltins()

  const prompt = getString(flags, 'prompt', 'p')
  if (!prompt) {
    throw new MorphixError(`--prompt is required.`, {
      code: 'E_NO_INPUT',
      exitCode: 64,
      hint: `mx image generate --prompt "..." [--n 2] [--aspect-ratio 16:9]`,
    })
  }

  const config = await loadConfig()
  const resolved = resolve({
    feature: 'image',
    flagProvider: getString(flags, 'provider'),
    flagModel: getString(flags, 'model'),
    config,
  })
  const { impl } = getCapability('image', resolved.provider, resolved.providerConfig)

  const result = await impl.generate(
    {
      prompt,
      n: getNumber(flags, 'n'),
      aspectRatio: getString(flags, 'aspect-ratio'),
      size: getString(flags, 'size'),
    },
    { model: resolved.model },
  )

  const outDir = getString(flags, 'out-dir', 'o') ?? config.outputDir ?? '.'
  let i = 0
  for (const asset of result.assets) {
    const ext = asset.ext ?? 'png'
    const name = `morphix-${Date.now()}-${i++}.${ext}`
    const full = join(outDir, name)
    if (asset.bytes) {
      const saved = await writeBytes(full, asset.bytes)
      console.log(saved)
    } else if (asset.url) {
      console.log(asset.url)
    }
  }
}

function printHelp(): void {
  console.log(`Usage: mx image generate [options]

  --prompt, -p <text>        Prompt describing the image.
  --n <count>                Number of images to generate.
  --aspect-ratio <a:b>       e.g. 16:9, 1:1, 9:16
  --size <WxH>               e.g. 1024x1024 (provider-specific)
  --out-dir, -o <dir>        Directory to save results. Default: config outputDir.
  --provider <id>            openai | gemini | comfyui
  --model <name>             Provider-specific model id.
`)
}
