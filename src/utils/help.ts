export function showHelp() {
  console.log(`
  ╔══════════════════════════════════════╗
  ║         MORPHIX CLI v0.1.0          ║
  ║   All-in-one multimedia processor   ║
  ╚══════════════════════════════════════╝

  Usage: morphix <command> [options] [args]
         mx <command> [options] [args]

  Commands:
    text     Text processing & conversion
    image    Image editing, conversion & generation
    video    Video encoding & editing
    audio    Audio conversion & editing

  Options:
    -h, --help       Show help
    -v, --version    Show version

  Examples:
    morphix text encode input.txt --format=base64
    mx image resize photo.jpg --width=800
    mx video convert clip.avi --to=mp4
    mx audio trim song.mp3 --start=0:30 --end=1:30
`)
}
