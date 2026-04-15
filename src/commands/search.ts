import { parseArgs, getString, getNumber } from '../utils/args.js'
import { MorphixError } from '../utils/errors.js'
import { loadConfig } from '../config/file.js'
import { resolve } from '../config/resolver.js'
import { registerBuiltins } from '../providers/index.js'
import { getCapability } from '../providers/registry.js'

export async function searchCommand(argv: string[]): Promise<void> {
  const { command: sub, args, flags } = parseArgs(argv)
  if (flags.help) {
    printHelp()
    return
  }
  // `mx search "query"` — treat positional as query, subcommand optional.
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
  --output <text|json>       Default: text.
  --provider <id>            gemini | openai
  --model <name>             Provider-specific model id.
`)
}
