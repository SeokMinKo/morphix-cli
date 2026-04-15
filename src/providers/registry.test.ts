import { describe, expect, it } from 'vitest'
import { listProvidersFor, registeredIds } from './registry.js'
import { registerBuiltins } from './index.js'

describe('registry after registerBuiltins', () => {
  registerBuiltins()

  it('lists all built-in providers', () => {
    expect(registeredIds().sort()).toEqual(
      ['anthropic', 'comfyui', 'gemini', 'ollama', 'openai', 'piapi', 'typecast'],
    )
  })

  it('reports correct providers for text', () => {
    expect(listProvidersFor('text').sort()).toEqual(['anthropic', 'gemini', 'ollama', 'openai'])
  })

  it('reports correct providers for image', () => {
    expect(listProvidersFor('image').sort()).toEqual(['comfyui', 'gemini', 'openai', 'piapi'])
  })

  it('reports correct providers for video', () => {
    expect(listProvidersFor('video').sort()).toEqual(['comfyui', 'gemini', 'piapi'])
  })

  it('reports correct providers for speech', () => {
    expect(listProvidersFor('speech').sort()).toEqual(['gemini', 'openai', 'typecast'])
  })

  it('reports correct providers for music', () => {
    expect(listProvidersFor('music').sort()).toEqual(['comfyui', 'piapi'])
  })

  it('reports correct providers for vision', () => {
    expect(listProvidersFor('vision').sort()).toEqual(['anthropic', 'gemini', 'ollama', 'openai'])
  })

  it('reports correct providers for search', () => {
    expect(listProvidersFor('search').sort()).toEqual(['gemini', 'openai'])
  })
})
