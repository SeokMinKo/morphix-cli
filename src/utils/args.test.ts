import { describe, expect, it } from 'vitest'
import { getBool, getNumber, getString, getStrings, parseArgs } from './args.js'

describe('parseArgs', () => {
  it('parses command, positional args, and flags', () => {
    const r = parseArgs(['text', 'chat', '--message', 'hi', '--stream'])
    expect(r.command).toBe('text')
    expect(r.args).toEqual(['chat'])
    expect(r.flags.message).toBe('hi')
    expect(r.flags.stream).toBe(true)
  })

  it('supports --key=value', () => {
    const r = parseArgs(['text', 'chat', '--model=gpt-4o-mini'])
    expect(r.flags.model).toBe('gpt-4o-mini')
  })

  it('accepts repeated flags as arrays', () => {
    const r = parseArgs(['text', 'chat', '-m', 'a', '--message', 'b', '-m', 'c'])
    expect(getStrings(r.flags, 'm', 'message')).toEqual(['a', 'c', 'b'])
  })

  it('short -h maps to help', () => {
    const r = parseArgs(['-h'])
    expect(r.flags.help).toBe(true)
  })

  it('passthrough after --', () => {
    const r = parseArgs(['search', '--', '--not-a-flag'])
    expect(r.command).toBe('search')
    expect(r.args).toEqual(['--not-a-flag'])
  })

  it('--flag without value at end of argv is boolean', () => {
    const r = parseArgs(['text', 'chat', '--stream'])
    expect(r.flags.stream).toBe(true)
  })

  it('--flag followed by non-flag becomes its value', () => {
    const r = parseArgs(['text', 'chat', '--model', 'gpt-4o'])
    expect(r.flags.model).toBe('gpt-4o')
  })
})

describe('flag helpers', () => {
  it('getString picks the last string among repeats', () => {
    const { flags } = parseArgs(['x', '--m', 'a', '--m', 'b'])
    expect(getString(flags, 'm')).toBe('b')
  })

  it('getBool handles false strings', () => {
    const { flags } = parseArgs(['x', '--stream=false'])
    expect(getBool(flags, 'stream')).toBe(false)
  })

  it('getNumber returns fallback on NaN', () => {
    const { flags } = parseArgs(['x', '--n=abc'])
    expect(getNumber(flags, 'n', 42)).toBe(42)
  })
})
