export async function imageCommand(args: string[]): Promise<void> {
  const subcommand = args[0]

  if (!subcommand) {
    console.log('Usage: morphix image <subcommand> [args]')
    console.log('Subcommands: resize, convert, compress, crop, info')
    return
  }

  console.log(`[image] ${subcommand} — not yet implemented`)
}
