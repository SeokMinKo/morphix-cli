export async function audioCommand(args: string[]): Promise<void> {
  const subcommand = args[0]

  if (!subcommand) {
    console.log('Usage: morphix audio <subcommand> [args]')
    console.log('Subcommands: convert, trim, merge, split, info')
    return
  }

  console.log(`[audio] ${subcommand} — not yet implemented`)
}
