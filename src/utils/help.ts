export function showHelp(): void {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║              MORPHIX CLI v0.1.0                 ║
  ║   Multi-provider AI generation at the terminal  ║
  ╚══════════════════════════════════════════════════╝

  Usage: morphix <command> [subcommand] [options]
         mx      <command> [subcommand] [options]

  Generation commands:
    text      Chat / text generation      (anthropic · openai · gemini · ollama)
    image     Image generation            (openai · gemini · comfyui)
    video     Video generation (async)    (gemini · comfyui)
    speech    Text-to-speech synthesis    (openai · gemini)
    music     Music generation            (comfyui)
    vision    Image understanding (VLM)   (anthropic · openai · gemini · ollama)
    search    Grounded web search         (gemini · openai)

  Management commands:
    auth      Manage provider credentials (login / status / logout)
    config    Read / write default providers and models (show / set / path)
    quota     Show usage / remaining credits per provider

  Provider & model selection (precedence: flag > env > config):
    --provider <id>           anthropic | openai | gemini | ollama | comfyui
    --model    <name>         Provider-specific model identifier

  Global options:
    -h, --help                Show help
    -v, --version             Show version

  Examples:
    mx text chat --message "Write a haiku about GPUs"
    mx text chat --provider openai --model gpt-4o-mini --message "hello"
    MORPHIX_TEXT_PROVIDER=ollama mx text chat --model llama3.2 --message "hi"
    mx image generate --prompt "sunset over seoul" --n 2 --aspect-ratio 16:9
    mx video generate --prompt "a drone flying over a forest" --async
    mx vision describe --image photo.jpg --prompt "what is this?"
    mx auth login --provider anthropic
    mx config set --key defaults.text.provider --value openai
`)
}
