/**
 * Eagerly register all built-in provider factories. Import this module for
 * its side effects once at CLI startup (command handlers do this indirectly
 * via registry lookups).
 */
import { registerProvider } from './registry.js'
import { createAnthropicProvider } from './anthropic/index.js'
import { createOllamaProvider } from './ollama/index.js'
import { createOpenAiProvider } from './openai/index.js'
import { createGeminiProvider } from './gemini/index.js'
import { createComfyuiProvider } from './comfyui/index.js'

let registered = false

export function registerBuiltins(): void {
  if (registered) return
  registered = true
  registerProvider('anthropic', createAnthropicProvider)
  registerProvider('openai', createOpenAiProvider)
  registerProvider('gemini', createGeminiProvider)
  registerProvider('ollama', createOllamaProvider)
  registerProvider('comfyui', createComfyuiProvider)
}
