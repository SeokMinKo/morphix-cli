import { join } from 'node:path'
import { parseArgs, getString, getNumber, getStrings } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'
import { writeBytes } from '../utils/fs.js'
import { readImageRef } from '../providers/shared/imageRef.js'
import { AssetSink, type RunContext } from '../utils/envelope.js'
import { CommandSpec, PROVIDER_FLAG, MODEL_FLAG } from './spec.js'
import type { SubjectReference } from '../capabilities/image.js'

export const spec: CommandSpec = {
  name: 'image',
  summary: 'Image generation.',
  capability: 'image',
  subcommands: [
    {
      name: 'generate',
      summary: 'Generate one or more images from a prompt.',
      flags: [
        { name: 'prompt', alias: 'p', type: 'string', required: true, description: 'Prompt text.' },
        { name: 'n', type: 'number', description: 'Number of images.' },
        { name: 'aspect-ratio', type: 'string', description: 'e.g. 16:9, 1:1, 9:16.' },
        { name: 'size', type: 'string', description: 'WxH, e.g. 1024x1024.' },
        { name: 'subject-ref', type: 'repeated-string', repeatable: true, description: 'Path or URL of a subject/character reference image (repeatable).' },
        { name: 'out-dir', alias: 'o', type: 'path', description: 'Output directory.' },
        PROVIDER_FLAG,
        MODEL_FLAG,
      ],
      outputs: [
        { kind: 'path', description: 'One saved file path per generated image, one per line.' },
        { kind: 'json', description: '{ assets: [{path, mime, bytes}] }' },
      ],
      examples: [
        'mx image generate --prompt "sunset over seoul" --n 2 --aspect-ratio 16:9',
        'mx image generate --prompt "[1] on a beach" --subject-ref ./face.png --provider gemini',
      ],
    },
  ],
}

export async function imageCommand(argv: string[], ctx: RunContext): Promise<void> {
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

  const subjectRefPaths = getStrings(flags, 'subject-ref')
  const subjectRefs = await loadSubjectRefs(subjectRefPaths)

  const result = await impl.generate(
    {
      prompt,
      n: getNumber(flags, 'n'),
      aspectRatio: getString(flags, 'aspect-ratio'),
      size: getString(flags, 'size'),
      subjectRefs: subjectRefs.length ? subjectRefs : undefined,
    },
    { model: resolved.model },
  )

  const outDir = getString(flags, 'out-dir', 'o') ?? config.outputDir ?? '.'
  const sink = new AssetSink(ctx)
  let i = 0
  for (const asset of result.assets) {
    const ext = asset.ext ?? 'png'
    const name = `morphix-${Date.now()}-${i++}.${ext}`
    const full = join(outDir, name)
    if (asset.bytes) {
      const saved = await writeBytes(full, asset.bytes)
      sink.path(saved, asset.mime, asset.bytes.byteLength, 'image')
    } else if (asset.url) {
      sink.url(asset.url, asset.mime, 'image')
    }
  }
  sink.flush('image.generate', { provider: resolved.provider, model: resolved.model }, result.usage)
}

async function loadSubjectRefs(paths: string[]): Promise<SubjectReference[]> {
  const out: SubjectReference[] = []
  for (const p of paths) {
    const ref = /^https?:\/\//i.test(p) ? { kind: 'url' as const, url: p } : { kind: 'path' as const, path: p }
    const { bytes, mime } = await readImageRef(ref)
    out.push({ bytes, mime })
  }
  return out
}

function printHelp(): void {
  console.log(`Usage: mx image generate [options]

  --prompt, -p <text>        Prompt describing the image.
  --n <count>                Number of images to generate.
  --aspect-ratio <a:b>       e.g. 16:9, 1:1, 9:16
  --size <WxH>               e.g. 1024x1024 (provider-specific)
  --subject-ref <path|url>   Reference image of subject/character (repeatable).
                             Providers:
                               openai/gpt-image-1  → /v1/images/edits
                               gemini/imagen-3      → referenceImages
                               comfyui              → workflow SUBJECT_REF var
  --out-dir, -o <dir>        Directory to save results. Default: config outputDir.
  --provider <id>            openai | gemini | comfyui
  --model <name>             Provider-specific model id.

  --json                     Emit one JSON envelope with all asset paths.
`)
}
