import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { parseArgs, getString, getBool, getStrings, getNumber } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'
import type { ChatMessage, Role, Usage } from '../capabilities/types.js'
import type { RunContext } from '../utils/envelope.js'
import { emitResult } from '../utils/envelope.js'
import { CommandSpec, PROVIDER_FLAG, MODEL_FLAG } from './spec.js'

export const spec: CommandSpec = {
  name: 'text',
  summary: 'Chat / text generation.',
  capability: 'text',
  subcommands: [
    {
      name: 'chat',
      summary: 'Run a chat completion (streaming by default).',
      flags: [
        { name: 'message', alias: 'm', type: 'repeated-string', repeatable: true, description: 'User message; repeatable for multi-turn. Prefix with role:' },
        { name: 'messages-file', type: 'path', description: 'JSON array of {role, content}. Use "-" for stdin.' },
        { name: 'system', type: 'string', description: 'System prompt.' },
        { name: 'no-stream', type: 'boolean', description: 'Disable streaming.' },
        { name: 'temperature', type: 'number', description: 'Sampling temperature.' },
        { name: 'max-tokens', type: 'number', description: 'Max output tokens.' },
        { name: 'output', alias: 'out', type: 'path', description: 'Write to file instead of stdout.' },
        { name: 'format', type: 'string', enum: ['text', 'json'], description: 'Per-command output format (distinct from global --json).' },
        PROVIDER_FLAG,
        MODEL_FLAG,
      ],
      outputs: [
        { kind: 'text', description: 'Streaming assistant text on stdout.' },
        { kind: 'json', description: 'With --json: { text, usage, provider, model }.' },
      ],
      examples: [
        'mx text chat -m "Write a haiku"',
        'mx text chat --provider openai --model gpt-4o-mini -m "hello"',
      ],
    },
  ],
}

export async function textCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { command: sub, args: rest, flags } = parseArgs(argv)
  if (!sub || flags.help) {
    printHelp()
    return
  }
  if (sub !== 'chat') {
    throw new MorphixError(`Unknown 'text' subcommand: '${sub}'`, {
      code: 'E_BAD_SUBCMD',
      exitCode: 64,
      hint: `Available: chat`,
    })
  }
  void rest

  registerBuiltins()

  const config = await loadConfig()
  const resolved = resolve({
    feature: 'text',
    flagProvider: getString(flags, 'provider'),
    flagModel: getString(flags, 'model'),
    config,
  })

  const { impl } = getCapability('text', resolved.provider, resolved.providerConfig)

  const messages = await loadMessages(flags)
  if (messages.length === 0) {
    throw new MorphixError(`No input messages.`, {
      code: 'E_NO_INPUT',
      exitCode: 64,
      hint: `Pass --message "text", repeat --message, or --messages-file path.json`,
    })
  }

  const system = getString(flags, 'system')
  const stream = !getBool(flags, 'no-stream')
  const temperature = getNumber(flags, 'temperature')
  const maxTokens = getNumber(flags, 'max-tokens')
  const outputPath = getString(flags, 'output', 'out')
  const format = getString(flags, 'format') ?? 'text'

  // In JSON envelope mode we never print the stream live — we collect and
  // emit one envelope at the end. This keeps stdout a single JSON line.
  const liveStream = !ctx.json && !outputPath && format === 'text'
  const out = outputPath ? createWriteStream(outputPath) : process.stdout

  let full = ''
  let lastUsage: Usage | undefined
  const iter = impl.chat(
    { messages, system },
    { model: resolved.model, stream, temperature, maxTokens },
  )
  for await (const chunk of iter) {
    if (chunk.text) {
      if (liveStream) out.write(chunk.text)
      full += chunk.text
    }
    if (chunk.usage) lastUsage = chunk.usage
    if (chunk.done && format === 'json' && !ctx.json) {
      out.write(
        JSON.stringify(
          {
            provider: resolved.provider,
            model: resolved.model,
            text: full,
            usage: chunk.usage,
          },
          null,
          2,
        ) + '\n',
      )
    }
  }
  if (liveStream) out.write('\n')

  if (ctx.json) {
    emitResult(
      ctx,
      'text.chat',
      { text: full },
      { usage: lastUsage, meta: { provider: resolved.provider, model: resolved.model } },
    )
  } else if (outputPath && format === 'text') {
    // Write the collected text to file for the non-live file-output case.
    out.write(full + '\n')
  }
}

async function loadMessages(flags: Record<string, unknown>): Promise<ChatMessage[]> {
  const messagesFile = getString(flags as Parameters<typeof getString>[0], 'messages-file')
  if (messagesFile) {
    const raw =
      messagesFile === '-'
        ? await readStdin()
        : await readFile(messagesFile, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      throw new MorphixError(`--messages-file must contain a JSON array of {role, content}`, {
        code: 'E_BAD_INPUT',
        exitCode: 64,
      })
    }
    return parsed.map((m): ChatMessage => {
      const rec = m as { role?: string; content?: string }
      return {
        role: (rec.role ?? 'user') as Role,
        content: rec.content ?? '',
      }
    })
  }

  const raw = getStrings(flags as Parameters<typeof getStrings>[0], 'message', 'm')
  const out: ChatMessage[] = []
  for (const item of raw) {
    const match = item.match(/^(system|user|assistant):(.*)$/s)
    if (match) {
      out.push({ role: match[1] as Role, content: match[2] })
    } else {
      out.push({ role: 'user', content: item })
    }
  }
  return out
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function printHelp(): void {
  console.log(`Usage: mx text chat [options]

  --message, -m <text>       User message. Can be repeated for multi-turn.
                             Prefix with 'system:', 'user:', or 'assistant:'
                             to set role (default: user).
  --messages-file <path>     Read a JSON array of {role, content} messages.
                             Use '-' for stdin.
  --system <text>            System prompt.
  --provider <id>            anthropic | openai | gemini | ollama
  --model <name>             Provider-specific model id.
  --no-stream                Disable streaming; wait for the full response.
  --temperature <n>          Sampling temperature.
  --max-tokens <n>           Maximum output tokens.
  --output, --out <path>     Write to file instead of stdout.
  --format <text|json>       Output format. Default: text.
                             (For the global AI envelope use --json.)

Examples:
  mx text chat -m "Write a haiku"
  mx text chat --provider openai --model gpt-4o-mini -m "hello"
  mx text chat --provider ollama --model llama3.2 -m "hi"
  cat convo.json | mx text chat --messages-file -
`)
}
