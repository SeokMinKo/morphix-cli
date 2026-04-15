#!/usr/bin/env node

import { parseArgs } from './utils/args.js'
import { showHelp } from './utils/help.js'
import { MorphixError, formatError } from './utils/errors.js'
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

type CommandHandler = (args: string[]) => Promise<void>

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
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv.slice(2))

  // Top-level --version fires only when no subcommand is invoked. Otherwise
  // -v / --version is passed through to the subcommand (mirrors --help).
  if (flags.version && !command) {
    console.log('morphix-cli v0.1.0')
    return
  }

  // Only show the top-level help when no command was given (or the user
  // explicitly typed `mx help`). With a command, --help is passed through
  // to the subcommand handler.
  if (!command || command === 'help') {
    showHelp()
    return
  }

  const handler = commands[command]
  if (!handler) {
    console.error(`Unknown command: ${command}`)
    console.error(`Available commands: ${Object.keys(commands).join(', ')}`)
    console.error(`Run "mx --help" for usage.`)
    process.exit(2)
  }

  // Reconstruct the argv slice that the subcommand handler sees: preserve all
  // flags and positional args after the top-level command. We rebuild here
  // because parseArgs already stripped flag/positional ordering.
  const subArgv = rebuildSubArgv(process.argv.slice(2), command)

  try {
    await handler(subArgv)
  } catch (err) {
    if (err instanceof MorphixError) {
      console.error(formatError(err))
      process.exit(err.exitCode)
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
