import { parseArgs, getString } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'
import type { ImageRef } from '../capabilities/types.js'
import { emitResult, type RunContext } from '../utils/envelope.js'
import { CommandSpec, PROVIDER_FLAG, MODEL_FLAG } from './spec.js'

export const spec: CommandSpec = {
  name: 'vision',
  summary: 'Image understanding (VLM).',
  capability: 'vision',
  subcommands: [
    {
      name: 'describe',
      summary: 'Describe or answer a question about an image.',
      flags: [
        { name: 'image', alias: 'i', type: 'string', required: true, description: 'Local file or URL.' },
        { name: 'prompt', alias: 'p', type: 'string', description: 'Optional question/instruction.' },
        PROVIDER_FLAG,
        MODEL_FLAG,
      ],
      outputs: [
        { kind: 'text', description: 'Natural-language description on stdout.' },
        { kind: 'json', description: '{ text, usage?, provider, model }' },
      ],
    },
  ],
}

export async function visionCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (flags.help) {
    printHelp()
    return
  }
  const subOrDefault = sub ?? 'describe'
  if (subOrDefault !== 'describe') {
    throw new MorphixError(`Unknown 'vision' subcommand: '${subOrDefault}'`, {
      code: 'E_BAD_SUBCMD',
      exitCode: 64,
      hint: `Available: describe`,
    })
  }

  registerBuiltins()

  const imagePath = getString(flags, 'image', 'i')
  if (!imagePath) {
    throw new MorphixError(`--image is required.`, {
      code: 'E_NO_INPUT',
      exitCode: 64,
      hint: `mx vision describe --image <path|url> [--prompt "..."]`,
    })
  }
  const image: ImageRef = /^https?:\/\//i.test(imagePath)
    ? { kind: 'url', url: imagePath }
    : { kind: 'path', path: imagePath }

  const config = await loadConfig()
  const resolved = resolve({
    feature: 'vision',
    flagProvider: getString(flags, 'provider'),
    flagModel: getString(flags, 'model'),
    config,
  })
  const { impl } = getCapability('vision', resolved.provider, resolved.providerConfig)

  const result = await impl.describe(
    { image, prompt: getString(flags, 'prompt', 'p') },
    { model: resolved.model },
  )
  if (ctx.json) {
    emitResult(ctx, 'vision.describe', { text: result.text }, { usage: result.usage, meta: { provider: resolved.provider, model: resolved.model } })
  } else {
    process.stdout.write(result.text + '\n')
  }
}

function printHelp(): void {
  console.log(`Usage: mx vision describe --image <path|url> [options]

  --image, -i <path|url>     Local file or URL of the image.
  --prompt, -p <text>        Question or instruction. Default: generic describe.
  --provider <id>            anthropic | openai | gemini | ollama
  --model <name>             Provider-specific model id.

Examples:
  mx vision describe --image photo.jpg --prompt "What breed is this?"
  mx vision describe -i https://example.com/img.png --provider openai
`)
}
