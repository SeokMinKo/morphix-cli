import { parseArgs, getString, getBool, getNumber } from '../utils/args.js'
import { MorphixError, UnsupportedCapabilityError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability, listProvidersFor } from '../providers/registry.js'
import { writeBytes } from '../utils/fs.js'
import { AssetSink, emitResult, type RunContext } from '../utils/envelope.js'
import { CommandSpec, PROVIDER_FLAG, MODEL_FLAG } from './spec.js'

export const spec: CommandSpec = {
  name: 'music',
  summary: 'Music generation and audio-to-audio cover/style transfer.',
  capability: 'music',
  subcommands: [
    {
      name: 'generate',
      summary: 'Generate music from a prompt.',
      flags: [
        { name: 'prompt', alias: 'p', type: 'string', required: true, description: 'Prompt describing the music.' },
        { name: 'lyrics', type: 'string', description: 'Optional lyrics.' },
        { name: 'instrumental', type: 'boolean', description: 'Instrumental only.' },
        { name: 'genre', type: 'string', description: 'Optional genre tag.' },
        { name: 'duration', type: 'number', description: 'Length in seconds.' },
        { name: 'out', type: 'path', required: true, description: 'Output audio file.' },
        PROVIDER_FLAG,
        MODEL_FLAG,
      ],
      outputs: [
        { kind: 'path', description: 'Saved audio file path.' },
        { kind: 'json', description: '{ assets: [{path,mime,bytes}] } or { jobId } for async.' },
      ],
    },
    {
      name: 'cover',
      summary: 'Audio-to-audio style transfer (ACE-Step I2A).',
      flags: [
        { name: 'input', alias: 'i', type: 'path', required: true, description: 'Source audio file.' },
        { name: 'prompt', alias: 'p', type: 'string', description: 'Optional steering prompt.' },
        { name: 'strength', type: 'number', description: 'Transformation strength 0..1 (default 0.75).' },
        { name: 'lyrics', type: 'string', description: 'Optional new lyrics.' },
        { name: 'duration', type: 'number', description: 'Override output length.' },
        { name: 'out', type: 'path', required: true, description: 'Output audio file.' },
        PROVIDER_FLAG,
        MODEL_FLAG,
      ],
      outputs: [
        { kind: 'path', description: 'Saved cover audio path.' },
        { kind: 'json', description: '{ assets: [{path,mime,bytes}] }' },
      ],
      examples: [
        'mx music cover --input song.mp3 --prompt "lo-fi acoustic" --out cover.wav',
      ],
    },
  ],
}

export async function musicCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  registerBuiltins()
  const config = await loadConfig()
  const resolved = resolve({
    feature: 'music',
    flagProvider: getString(flags, 'provider'),
    flagModel: getString(flags, 'model'),
    config,
  })
  const { impl } = getCapability('music', resolved.provider, resolved.providerConfig)

  if (sub === 'generate' || sub === 'gen') {
    const prompt = getString(flags, 'prompt', 'p')
    if (!prompt) throw new MorphixError(`--prompt is required.`, { code: 'E_NO_INPUT', exitCode: 64 })
    const outPath = getString(flags, 'output', 'out')
    if (!outPath) throw new MorphixError(`--out is required.`, { code: 'E_NO_INPUT', exitCode: 64 })

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
      if (ctx.json) emitResult(ctx, 'music.generate', { jobId: result.jobId, provider: resolved.provider })
      else console.log(JSON.stringify({ jobId: result.jobId, provider: resolved.provider }))
      return
    }
    await writeAssets(result.assets, outPath, ctx, 'music.generate', resolved.provider, resolved.model)
    return
  }

  if (sub === 'cover') {
    if (!impl.cover) {
      const supported = listProvidersFor('music').filter((p) => {
        try {
          const { impl: i } = getCapability('music', p, resolved.providerConfig)
          return !!i.cover
        } catch {
          return false
        }
      })
      throw new UnsupportedCapabilityError(resolved.provider, 'music.cover', supported)
    }
    const input = getString(flags, 'input', 'i')
    if (!input) throw new MorphixError(`--input is required.`, { code: 'E_NO_INPUT', exitCode: 64 })
    const outPath = getString(flags, 'output', 'out')
    if (!outPath) throw new MorphixError(`--out is required.`, { code: 'E_NO_INPUT', exitCode: 64 })

    const result = await impl.cover(
      {
        referenceAudioPath: input,
        prompt: getString(flags, 'prompt', 'p'),
        strength: getNumber(flags, 'strength'),
        lyrics: getString(flags, 'lyrics'),
        durationSec: getNumber(flags, 'duration'),
      },
      { model: resolved.model },
    )
    if (result.kind === 'async') {
      if (ctx.json) emitResult(ctx, 'music.cover', { jobId: result.jobId, provider: resolved.provider })
      else console.log(JSON.stringify({ jobId: result.jobId, provider: resolved.provider }))
      return
    }
    await writeAssets(result.assets, outPath, ctx, 'music.cover', resolved.provider, resolved.model)
    return
  }

  throw new MorphixError(`Unknown 'music' subcommand: '${sub}'`, {
    code: 'E_BAD_SUBCMD',
    exitCode: 64,
    hint: `Available: generate, cover`,
  })
}

async function writeAssets(
  assets: { bytes?: Uint8Array; url?: string; mime?: string }[],
  outPath: string,
  ctx: RunContext,
  command: string,
  provider: string,
  model: string,
): Promise<void> {
  const sink = new AssetSink(ctx)
  for (const asset of assets) {
    if (asset.bytes) {
      const saved = await writeBytes(outPath, asset.bytes)
      sink.path(saved, asset.mime, asset.bytes.byteLength, 'audio')
    } else if (asset.url) {
      sink.url(asset.url, asset.mime, 'audio')
    }
  }
  sink.flush(command, { provider, model })
}

function printHelp(): void {
  console.log(`Usage: mx music <generate|cover> [options]

  generate --prompt <text> --out <path> [--lyrics <t>] [--instrumental]
                                       [--genre <name>] [--duration <sec>]
  cover    --input <path> --out <path> [--prompt <t>] [--strength <0..1>]
                                       [--lyrics <t>] [--duration <sec>]
           Audio→audio style transfer (ACE-Step I2A). Requires:
             mx config set --key providers.comfyui.extra.coverWorkflow --value /path.json

  --provider <id>            comfyui
  --model <name>             Provider-specific model id.
`)
}
