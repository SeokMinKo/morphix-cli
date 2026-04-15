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

export async function videoCommand(argv: string[]): Promise<void> {
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
      return doGenerate(flags, config)
    case 'poll':
    case 'task':
      return doPoll(flags, config)
    case 'fetch':
    case 'download':
      return doFetch(flags, config)
    default:
      throw new MorphixError(`Unknown 'video' subcommand: '${sub}'`, {
        code: 'E_BAD_SUBCMD',
        exitCode: 64,
        hint: `Available: generate, poll, fetch`,
      })
  }
}

async function doGenerate(flags: Record<string, unknown>, config: MorphixConfig): Promise<void> {
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
    console.log(JSON.stringify({ jobId, provider: resolved.provider }))
    return
  }
  // Inline poll loop
  process.stderr.write(`submitted job ${jobId} — polling…\n`)
  while (true) {
    const status = await impl.poll(jobId)
    process.stderr.write(`  state=${status.state}${status.progress ? ` (${status.progress}%)` : ''}\n`)
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
  await emitAssets(assets, flags, config, resolved.provider)
}

async function doPoll(flags: Record<string, unknown>, config: MorphixConfig): Promise<void> {
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
  console.log(JSON.stringify(status, null, 2))
}

async function doFetch(flags: Record<string, unknown>, config: MorphixConfig): Promise<void> {
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
  await emitAssets(assets, flags, config, resolved.provider)
}

/**
 * Write inline bytes to disk (honoring --out / --out-dir / config.outputDir)
 * and print the saved path or remote URL. Previously these were silently
 * discarded with a "(inline bytes)" placeholder.
 */
async function emitAssets(
  assets: Asset[],
  flags: Record<string, unknown>,
  config: MorphixConfig,
  provider: string,
): Promise<void> {
  const outFlag = getString(flags as Parameters<typeof getString>[0], 'out', 'output')
  const outDir = getString(flags as Parameters<typeof getString>[0], 'out-dir', 'o') ?? config.outputDir ?? '.'
  let i = 0
  for (const a of assets) {
    if (a.bytes) {
      const ext = a.ext ?? 'mp4'
      const name =
        outFlag && assets.length === 1
          ? outFlag
          : join(outDir, `morphix-${provider}-${Date.now()}-${i}.${ext}`)
      const saved = await writeBytes(name, a.bytes)
      console.log(saved)
    } else if (a.url) {
      console.log(a.url)
    }
    i++
  }
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
