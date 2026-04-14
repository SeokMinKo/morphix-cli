#!/usr/bin/env node

import { parseArgs } from './utils/args.js'
import { showHelp } from './utils/help.js'
import { textCommand } from './commands/text.js'
import { imageCommand } from './commands/image.js'
import { videoCommand } from './commands/video.js'
import { audioCommand } from './commands/audio.js'

const commands: Record<string, (args: string[]) => Promise<void>> = {
  text: textCommand,
  image: imageCommand,
  video: videoCommand,
  audio: audioCommand,
}

async function main() {
  const { command, args, flags } = parseArgs(process.argv.slice(2))

  if (!command || flags.help) {
    showHelp()
    process.exit(0)
  }

  if (flags.version) {
    console.log('morphix-cli v0.1.0')
    process.exit(0)
  }

  const handler = commands[command as string]
  if (!handler) {
    console.error(`Unknown command: ${command}`)
    console.error(`Available commands: ${Object.keys(commands).join(', ')}`)
    process.exit(1)
  }

  try {
    await handler(args)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

main()
