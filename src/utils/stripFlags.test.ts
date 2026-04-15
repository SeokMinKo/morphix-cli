import { describe, expect, it } from 'vitest'
import { stripFlags } from './args.js'

describe('stripFlags', () => {
  it('removes boolean global flags from argv', () => {
    const r = stripFlags(['--json', 'image', 'generate', '--prompt', 'cat'], ['json'])
    expect(r.argv).toEqual(['image', 'generate', '--prompt', 'cat'])
    expect(r.extracted.json).toBe(true)
  })

  it('handles --flag=value form for boolean flags', () => {
    const r = stripFlags(['--json=false', 'foo'], ['json'])
    expect(r.argv).toEqual(['foo'])
    expect(r.extracted.json).toBe(false)
  })

  it('extracts string-valued globals (e.g. --format)', () => {
    const r = stripFlags(['--format', 'json', 'list', 'providers'], [], ['format'])
    expect(r.argv).toEqual(['list', 'providers'])
    expect(r.extracted.format).toBe('json')
  })

  it('does not consume value-shaped non-flag tokens beyond known globals', () => {
    const r = stripFlags(['image', '--prompt', 'cat', '--json'], ['json'])
    expect(r.argv).toEqual(['image', '--prompt', 'cat'])
    expect(r.extracted.json).toBe(true)
  })

  it('handles --non-interactive boolean global', () => {
    const r = stripFlags(['--non-interactive', 'auth', 'login'], ['non-interactive'])
    expect(r.argv).toEqual(['auth', 'login'])
    expect(r.extracted['non-interactive']).toBe(true)
  })
})
