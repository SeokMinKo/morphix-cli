import { join } from 'node:path'
import { parseArgs, getString, getBool, getNumber } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'
import { writeBytes } from '../utils/fs.js'
import type { Asset } from '../capabilities/types.js'
import type { MorphixConfig } from '../config/schema.js'
import { AssetSink, emitResult, type RunContext } from '../utils/envelope.js'
import { CommandSpec, PROVIDER_FLAG, MODEL_FLAG } from './spec.js'

export const spec: CommandSpec = {
  name: 'video',
  summary: 'Video generation (async submit/poll/fetch).',
  capability: 'video',
  subcommands: [
    {
      name: 'generate',
      summary: 'Submit a video generation job (polls inline by default).',
      flags: [
        { name: 'prompt', alias: 'p', type: 'string', required: true, description: 'Prompt text.' },
        { name: 'duration', type: 'number', description: 'Duration in seconds.' },
        { name: 'aspect-ratio', type: 'string', description: 'e.g. 16:9, 1:1.' },
        { name: 'async', type: 'boolean', description: 'Return jobId immediately without polling.' },
        { name: 'out', type: 'path', description: 'Output file (single-asset jobs).' },
        { name: 'out-dir', alias: 'o', type: 'path', description: 'Output directory.' },
        PROVIDER_FLAG,
        MODEL_FLAG,
      ],
      outputs: [
        { kind: 'path', description: 'Saved video file path.' },
        { kind: 'json', description: '{ assets: [{path,mime,bytes}] } or { jobId } with --async.' },
      ],
    },
    {
      name: 'poll',
      summary: 'Poll an existing video job once.',
      flags: [
        { name: 'job-id', type: 'string', required: true, description: 'Job ID returned by generate --async.' },
        PROVIDER_FLAG,
      ],
      outputs: [{ kind: 'json', description: '{ jobId, state, progress?, error? }' }],
    },
    {
      name: 'fetch',
      summary: 'Download assets for a completed video job.',
      flags: [
        { name: 'job-id', type: 'string', required: true, description: 'Job ID.' },
        { name: 'out', type: 'path', description: 'Output file.' },
        { name: 'out-dir', alias: 'o', type: 'path', description: 'Output directory.' },
        PROVIDER_FLAG,
      ],
      outputs: [{ kind: 'path', description: 'Saved video file path.' }],
    },
  ],
}

export async function videoCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  registerBuiltins()

  const config = await loadConfig()
  switch (sub) {
    case 'generate':
    case 'gen':
      return doGenerate(flags, config, ctx)
    case 'poll':
    case 'task':
      return doPoll(flags, config, ctx)
    case 'fetch':
    case 'download':
      return doFetch(flags, config, ctx)
    default:
      throw new MorphixError(`Unknown 'video' subcommand: '${sub}'`, {
        code: 'E_BAD_SUBCMD',
        exitCode: 64,
        hint: `Available: generate, poll, fetch`,
      })
  }
}

async function doGenerate(flags: Record<string, unknown>, config: MorphixConfig, ctx: RunContext): Promise<void> {
  const prompt = getString(flags as Parameters<typeof getString>[0], 'prompt', 'p')
  if (!prompt) {
    throw new MorphixError(`--prompt is required.`, { code: 'E_NO_INPUT', exitCode: 64 })
  }
  const resolved = resolve({
    feature: 'video',
    flagProvider: getString(flags as Parameters<typeof getString>[0], 'provider'),
    flagModel: getString(flags as Parameters<typeof getString>[0], 'model'),
    config,
  })
  const { impl } = getCapability('video', resolved.provider, resolved.providerConfig)
  const { jobId } = await impl.submit(
    {
      prompt,
      durationSec: getNumber(flags as Parameters<typeof getNumber>[0], 'duration'),
      aspectRatio: getString(flags as Parameters<typeof getString>[0], 'aspect-ratio'),
    },
    { model: resolved.model },
  )
  if (getBool(flags as Parameters<typeof getBool>[0], 'async')) {
    if (ctx.json) emitResult(ctx, 'video.generate', { jobId, provider: resolved.provider }, { meta: { provider: resolved.provider, model: resolved.model } })
    else console.log(JSON.stringify({ jobId, provider: resolved.provider }))
    return
  }
  if (!ctx.quiet) process.stderr.write(`submitted job ${jobId} — polling…\n`)
  while (true) {
    const status = await impl.poll(jobId)
    if (!ctx.quiet) {
      process.stderr.write(`  state=${status.state}${status.progress ? ` (${status.progress}%)` : ''}\n`)
    }
    if (status.state === 'done') break
    if (status.state === 'error') {
      throw new MorphixError(`Video job failed: ${status.error ?? 'unknown'}`, {
        code: 'E_JOB_FAILED',
        exitCode: 70,
      })
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  const { assets } = await impl.fetch(jobId)
  await emitAssets(assets, flags, config, resolved.provider, resolved.model, ctx, 'video.generate')
}

async function doPoll(flags: Record<string, unknown>, config: MorphixConfig, ctx: RunContext): Promise<void> {
  const jobId = getString(flags as Parameters<typeof getString>[0], 'job-id', 'task-id')
  if (!jobId) throw new MorphixError(`--job-id is required.`, { code: 'E_NO_INPUT', exitCode: 64 })
  const resolved = resolve({
    feature: 'video',
    flagProvider: getString(flags as Parameters<typeof getString>[0], 'provider'),
    flagModel: getString(flags as Parameters<typeof getString>[0], 'model'),
    config,
  })
  const { impl } = getCapability('video', resolved.provider, resolved.providerConfig)
  const status = await impl.poll(jobId)
  if (ctx.json) emitResult(ctx, 'video.poll', status, { meta: { provider: resolved.provider } })
  else console.log(JSON.stringify(status, null, 2))
}

async function doFetch(flags: Record<string, unknown>, config: MorphixConfig, ctx: RunContext): Promise<void> {
  const jobId = getString(flags as Parameters<typeof getString>[0], 'job-id', 'task-id')
  if (!jobId) throw new MorphixError(`--job-id is required.`, { code: 'E_NO_INPUT', exitCode: 64 })
  const resolved = resolve({
    feature: 'video',
    flagProvider: getString(flags as Parameters<typeof getString>[0], 'provider'),
    flagModel: getString(flags as Parameters<typeof getString>[0], 'model'),
    config,
  })
  const { impl } = getCapability('video', resolved.provider, resolved.providerConfig)
  const { assets } = await impl.fetch(jobId)
  await emitAssets(assets, flags, config, resolved.provider, resolved.model, ctx, 'video.fetch')
}

async function emitAssets(
  assets: Asset[],
  flags: Record<string, unknown>,
  config: MorphixConfig,
  provider: string,
  model: string,
  ctx: RunContext,
  command: string,
): Promise<void> {
  const outFlag = getString(flags as Parameters<typeof getString>[0], 'out', 'output')
  const outDir = getString(flags as Parameters<typeof getString>[0], 'out-dir', 'o') ?? config.outputDir ?? '.'
  const sink = new AssetSink(ctx)
  let i = 0
  for (const a of assets) {
    if (a.bytes) {
      const ext = a.ext ?? 'mp4'
      const name =
        outFlag && assets.length === 1
          ? outFlag
          : join(outDir, `morphix-${provider}-${Date.now()}-${i}.${ext}`)
      const saved = await writeBytes(name, a.bytes)
      sink.path(saved, a.mime, a.bytes.byteLength, 'video')
    } else if (a.url) {
      sink.url(a.url, a.mime, 'video')
    }
    i++
  }
  sink.flush(command, { provider, model })
}

function printHelp(): void {
  console.log(`Usage: mx video <generate|poll|fetch> [options]

  generate --prompt <text> [--duration <sec>] [--aspect-ratio <a:b>] [--async]
           Submits a generation job and (by default) polls until done.
           With --async, prints the jobId and exits immediately.

  poll     --job-id <id>
           Print job state (pending|running|done|error).

  fetch    --job-id <id>
           Retrieve assets for a completed job.

  --out <path>               Output file (single-asset jobs).
  --out-dir, -o <dir>        Directory to save results. Default: config outputDir.
  --provider <id>            gemini | comfyui
  --model <name>             Provider-specific model id.
`)
}
