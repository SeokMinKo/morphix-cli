export async function videoCommand(args: string[]): Promise<void> {
  const subcommand = args[0]

  if (!subcommand) {
    console.log('Usage: morphix video <subcommand> [args]')
    console.log('Subcommands: convert, trim, compress, extract, info')
    return
  }

  console.log(`[video] ${subcommand} — not yet implemented`)
}
