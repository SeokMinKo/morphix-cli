export async function textCommand(args: string[]): Promise<void> {
  const subcommand = args[0]

  if (!subcommand) {
    console.log('Usage: morphix text <subcommand> [args]')
    console.log('Subcommands: encode, decode, count, hash, format')
    return
  }

  console.log(`[text] ${subcommand} — not yet implemented`)
}
