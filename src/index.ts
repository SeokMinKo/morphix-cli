#!/usr/bin/env node

import { parseArgs, stripFlags } from './utils/args.js'
import { showHelp } from './utils/help.js'
import { MorphixError, formatError } from './utils/errors.js'
import { defaultRunContext, emitError, type RunContext } from './utils/envelope.js'
import { textCommand } from './commands/text.js'
import { imageCommand } from './commands/image.js'
import { videoCommand } from './commands/video.js'
import { speechCommand } from './commands/speech.js'
import { musicCommand } from './commands/music.js'
import { visionCommand } from './commands/vision.js'
import { searchCommand } from './commands/search.js'
import { authCommand } from './commands/auth.js'
import { configCommand } from './commands/config.js'
import { quotaCommand } from './commands/quota.js'
import { schemaCommand, listCommand } from './commands/schema.js'
import { updateCommand } from './commands/update.js'

type CommandHandler = (args: string[], ctx: RunContext) => Promise<void>

const commands: Record<string, CommandHandler> = {
  text: textCommand,
  image: imageCommand,
  video: videoCommand,
  speech: speechCommand,
  music: musicCommand,
  vision: visionCommand,
  search: searchCommand,
  auth: authCommand,
  config: configCommand,
  quota: quotaCommand,
  schema: schemaCommand,
  list: listCommand,
  update: updateCommand,
}

async function main(): Promise<void> {
  // Extract global flags from the raw argv BEFORE parseArgs so downstream
  // command handlers never see them. `--format=json` at the top level is
  // also accepted as a legacy alias for --json (for shell-script users).
  const rawArgv = process.argv.slice(2)
  const { argv: argvAfterGlobals, extracted } = stripFlags(
    rawArgv,
    ['json', 'non-interactive', 'quiet'],
    ['format'],
  )
  const ctx: RunContext = {
    ...defaultRunContext(),
    json: extracted.json === true || extracted.format === 'json',
    nonInteractive: extracted['non-interactive'] === true || !process.stdin.isTTY,
    quiet: extracted.quiet === true,
  }

  const { command, flags } = parseArgs(argvAfterGlobals)

  if (flags.version && !command) {
    if (ctx.json) {
      process.stdout.write(JSON.stringify({ ok: true, command: 'version', data: { version: '0.1.0' } }) + '\n')
    } else {
      console.log('morphix-cli v0.1.0')
    }
    return
  }

  if (!command || command === 'help') {
    if (ctx.json) {
      // In JSON mode, `mx --help` returns the manifest for agent bootstrap.
      await schemaCommand([], ctx)
      return
    }
    showHelp()
    return
  }

  const handler = commands[command]
  if (!handler) {
    if (ctx.json) {
      process.stderr.write(
        JSON.stringify({
          ok: false,
          error: {
            code: 'E_BAD_COMMAND',
            message: `Unknown command: ${command}`,
            hint: `Available: ${Object.keys(commands).join(', ')}`,
            exitCode: 2,
          },
        }) + '\n',
      )
    } else {
      console.error(`Unknown command: ${command}`)
      console.error(`Available commands: ${Object.keys(commands).join(', ')}`)
      console.error(`Run "mx --help" for usage.`)
    }
    process.exit(2)
  }

  const subArgv = rebuildSubArgv(argvAfterGlobals, command)

  try {
    await handler(subArgv, ctx)
  } catch (err) {
    if (err instanceof MorphixError) {
      if (ctx.json) {
        const code = emitError(ctx, err)
        process.exit(code)
      }
      console.error(formatError(err))
      process.exit(err.exitCode)
    }
    if (ctx.json) {
      const code = emitError(ctx, err)
      process.exit(code)
    }
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

function rebuildSubArgv(argv: string[], command: string): string[] {
  const idx = argv.indexOf(command)
  if (idx < 0) return []
  return argv.slice(idx + 1)
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
