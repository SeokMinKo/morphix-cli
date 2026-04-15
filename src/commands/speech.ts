import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { parseArgs, getString, getNumber, getBool } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'
import { AssetSink, emitResult, type RunContext } from '../utils/envelope.js'
import { CommandSpec, PROVIDER_FLAG, MODEL_FLAG } from './spec.js'

export const spec: CommandSpec = {
  name: 'speech',
  summary: 'Text-to-speech synthesis (with optional stdout streaming).',
  capability: 'speech',
  subcommands: [
    {
      name: 'synthesize',
      summary: 'Synthesize speech to a file or stdout.',
      flags: [
        { name: 'text', alias: 't', type: 'string', required: true, description: 'Text to synthesize.' },
        { name: 'out', type: 'path', description: 'Output audio file. Required unless --stream.' },
        { name: 'voice', type: 'string', description: 'Provider-specific voice id.' },
        { name: 'speed', type: 'number', description: 'Playback speed (provider-specific).' },
        { name: 'stream', type: 'boolean', description: 'Pipe binary audio chunks to stdout. Cannot combine with --json.' },
        PROVIDER_FLAG,
        MODEL_FLAG,
      ],
      outputs: [
        { kind: 'path', description: 'Saved audio file path (when --out).' },
        { kind: 'bytes-stdout', description: 'Raw audio bytes on stdout (when --stream).' },
        { kind: 'json', description: '{ assets: [{path,mime,bytes}] } (file mode + --json).' },
      ],
      examples: [
        'mx speech synthesize --text "hello" --out hello.mp3',
        'mx speech synthesize --text "hello" --stream | ffplay -',
      ],
    },
    {
      name: 'voices',
      summary: 'List available voices for the provider.',
      flags: [PROVIDER_FLAG],
      outputs: [{ kind: 'json', description: 'Array of {id, name, language?, gender?}.' }],
    },
  ],
}

export async function speechCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { command: sub, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  registerBuiltins()

  if (sub === 'voices') {
    return doVoices(flags, ctx)
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
  const stream = getBool(flags, 'stream')
  const outPath = getString(flags, 'output', 'out')

  if (stream && ctx.json) {
    throw new MorphixError(`--stream is incompatible with --json (would mix binary audio and JSON on stdout).`, {
      code: 'E_STREAM_REQUIRES_OUT',
      exitCode: 64,
      hint: `Use either --stream OR --json. With --json, also pass --out <path>.`,
    })
  }
  if (!stream && !outPath) {
    throw new MorphixError(`--out is required.`, {
      code: 'E_NO_INPUT',
      exitCode: 64,
      hint: `mx speech synthesize --text "..." --out hello.mp3   (or pass --stream to pipe to stdout)`,
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

  const format = outPath ? inferFormat(outPath) : 'mp3'
  const audioStream = impl.synthesize(
    {
      text,
      voice: getString(flags, 'voice'),
      speed: getNumber(flags, 'speed'),
    },
    { model: resolved.model, format },
  )

  // Stream-only mode: dump bytes to stdout.
  if (stream && !outPath) {
    for await (const chunk of audioStream) {
      const ok = process.stdout.write(chunk)
      if (!ok) await once(process.stdout, 'drain')
    }
    return
  }

  // File mode (optionally also mirroring to stdout when --stream + --out).
  const ws = createWriteStream(outPath!)
  let bytes = 0
  for await (const chunk of audioStream) {
    bytes += chunk.byteLength
    if (stream) {
      const ok = process.stdout.write(chunk)
      if (!ok) await once(process.stdout, 'drain')
    }
    if (!ws.write(chunk)) await once(ws, 'drain')
  }
  ws.end()
  await once(ws, 'finish')
  if (ctx.json) {
    emitResult(ctx, 'speech.synthesize', {
      assets: [{ path: outPath, mime: mimeFromExt(outPath!), bytes, kind: 'audio' }],
    }, { meta: { provider: resolved.provider, model: resolved.model } })
  } else {
    console.log(outPath)
  }
}

function inferFormat(path: string): 'mp3' | 'wav' | 'opus' | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'mp3' || ext === 'wav' || ext === 'opus') return ext
  return undefined
}

function mimeFromExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'opus') return 'audio/opus'
  return 'application/octet-stream'
}

async function doVoices(flags: Record<string, unknown>, ctx: RunContext): Promise<void> {
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
  if (ctx.json) emitResult(ctx, 'speech.voices', voices, { meta: { provider: resolved.provider } })
  else console.log(JSON.stringify(voices, null, 2))
  // Quiet AssetSink import (kept to keep the file consistent with other commands).
  void AssetSink
}

function printHelp(): void {
  console.log(`Usage: mx speech <synthesize|voices> [options]

  synthesize --text <t> [--out <path>] [--stream]
                                       [--voice <id>] [--speed <n>]
             --stream pipes raw audio bytes to stdout (mp3 by default).
             --out and --stream may be combined to mirror to file + stdout.
  voices                     List available voices for the provider.

  --provider <id>            openai | gemini
  --model <name>             Provider-specific model id.
`)
}
