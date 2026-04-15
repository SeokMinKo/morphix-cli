import { parseArgs, getString, getNumber } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'
import { emitResult, type RunContext } from '../utils/envelope.js'
import { CommandSpec, PROVIDER_FLAG, MODEL_FLAG } from './spec.js'

export const spec: CommandSpec = {
  name: 'search',
  summary: 'Grounded web search.',
  capability: 'search',
  flags: [
    { name: 'q', type: 'string', description: 'Query (or pass as positional).' },
    { name: 'limit', type: 'number', description: 'Max results.' },
    { name: 'output', type: 'string', enum: ['text', 'json'], description: 'Per-command output format.' },
    PROVIDER_FLAG,
    MODEL_FLAG,
  ],
  outputs: [
    { kind: 'text', description: 'Answer + result list (human mode).' },
    { kind: 'json', description: '{ results: [...], answer? }' },
  ],
  examples: ['mx search "best ramen in seoul" --limit 5'],
}

export async function searchCommand(argv: string[], ctx: RunContext): Promise<void> {
  const { command: sub, args, flags } = parseArgs(argv)
  if (flags.help) {
    printHelp()
    return
  }
  let q = getString(flags, 'q')
  if (!q) {
    if (sub && sub !== 'query') q = [sub, ...args].join(' ')
    else q = args.join(' ') || undefined
  }
  if (!q) {
    throw new MorphixError(`Search query required.`, {
      code: 'E_NO_INPUT',
      exitCode: 64,
      hint: `mx search "your query" [--provider gemini]`,
    })
  }

  registerBuiltins()
  const config = await loadConfig()
  const resolved = resolve({
    feature: 'search',
    flagProvider: getString(flags, 'provider'),
    flagModel: getString(flags, 'model'),
    config,
  })
  const { impl } = getCapability('search', resolved.provider, resolved.providerConfig)

  const result = await impl.query({ q }, { model: resolved.model, limit: getNumber(flags, 'limit') })

  if (ctx.json) {
    emitResult(ctx, 'search.query', result, { meta: { provider: resolved.provider, model: resolved.model } })
    return
  }

  const format = getString(flags, 'output') ?? 'text'
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (result.answer) {
    console.log(result.answer)
    console.log()
  }
  for (const r of result.results) {
    console.log(`- ${r.title}`)
    console.log(`  ${r.url}`)
    if (r.snippet) console.log(`  ${r.snippet}`)
  }
}

function printHelp(): void {
  console.log(`Usage: mx search "<query>" [options]
       mx search query --q "<query>" [options]

  --q <query>                The search query (or use positional arg).
  --limit <n>                Max results.
  --output <text|json>       Default: text. (For the global envelope use --json.)
  --provider <id>            gemini | openai
  --model <name>             Provider-specific model id.
`)
}
