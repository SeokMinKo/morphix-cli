import { describe, expect, it, vi } from 'vitest'
import { AssetSink, defaultRunContext, emitError, emitResult } from './envelope.js'
import { MissingProviderError, MorphixError, ProviderHttpError } from './errors.js'

function captureStdout(fn: () => void): string {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string | Uint8Array): boolean => {
    chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'))
    return true
  }) as typeof process.stdout.write
  try {
    fn()
  } finally {
    process.stdout.write = orig
  }
  return chunks.join('')
}

function captureStderr(fn: () => void): string {
  const chunks: string[] = []
  const orig = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((s: string | Uint8Array): boolean => {
    chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'))
    return true
  }) as typeof process.stderr.write
  try {
    fn()
  } finally {
    process.stderr.write = orig
  }
  return chunks.join('')
}

describe('emitResult', () => {
  it('is a no-op when ctx.json is false', () => {
    const ctx = { ...defaultRunContext(), json: false }
    const out = captureStdout(() => emitResult(ctx, 'text.chat', { text: 'hi' }))
    expect(out).toBe('')
  })

  it('emits a single JSON line on success when ctx.json is true', () => {
    const ctx = { ...defaultRunContext(), json: true, startMs: Date.now() - 5 }
    const out = captureStdout(() =>
      emitResult(ctx, 'text.chat', { text: 'hi' }, { meta: { provider: 'openai' } }),
    )
    const parsed = JSON.parse(out.trim())
    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('text.chat')
    expect(parsed.data).toEqual({ text: 'hi' })
    expect(parsed.meta.provider).toBe('openai')
    expect(parsed.meta.durationMs).toBeGreaterThanOrEqual(0)
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('emitError', () => {
  it('returns the MorphixError exitCode and emits envelope on stderr in json mode', () => {
    const ctx = { ...defaultRunContext(), json: true }
    const stderr = captureStderr(() => {
      const code = emitError(ctx, new MissingProviderError('image'))
      expect(code).toBe(64)
    })
    const parsed = JSON.parse(stderr.trim())
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('E_NO_PROVIDER')
    expect(parsed.error.exitCode).toBe(64)
  })

  it('includes httpStatus from ProviderHttpError', () => {
    const ctx = { ...defaultRunContext(), json: true }
    const stderr = captureStderr(() => emitError(ctx, new ProviderHttpError('openai', 503, 'oops')))
    const parsed = JSON.parse(stderr.trim())
    expect(parsed.error.httpStatus).toBe(503)
    expect(parsed.error.exitCode).toBe(75)
  })

  it('wraps non-MorphixError as E_INTERNAL with exit 1', () => {
    const ctx = { ...defaultRunContext(), json: true }
    const stderr = captureStderr(() => {
      const code = emitError(ctx, new Error('boom'))
      expect(code).toBe(1)
    })
    const parsed = JSON.parse(stderr.trim())
    expect(parsed.error.code).toBe('E_INTERNAL')
    expect(parsed.error.message).toBe('boom')
  })

  it('redacts api-key-shaped substrings from message and hint', () => {
    const ctx = { ...defaultRunContext(), json: true }
    const err = new MorphixError('failure with key sk-ant-abcdefghij1234567890', {
      hint: 'try again with sk-proj-XXXXXXXXXXXXXXXXXXXXXXXX',
      code: 'E_TEST',
      exitCode: 70,
    })
    const stderr = captureStderr(() => emitError(ctx, err))
    expect(stderr).not.toContain('sk-ant-abcdefghij1234567890')
    expect(stderr).not.toContain('XXXXXXXXXXXXXXXXXXXXXXXX')
  })
})

describe('AssetSink', () => {
  it('prints paths immediately in human mode and accumulates in json mode', () => {
    const ctxHuman = { ...defaultRunContext(), json: false }
    const ctxJson = { ...defaultRunContext(), json: true }

    const humanOut = captureStdout(() => {
      const sink = new AssetSink(ctxHuman)
      sink.path('/tmp/a.png', 'image/png', 100)
      sink.path('/tmp/b.png', 'image/png', 200)
      sink.flush('image.generate')
    })
    expect(humanOut).toBe('/tmp/a.png\n/tmp/b.png\n')

    const jsonOut = captureStdout(() => {
      const sink = new AssetSink(ctxJson)
      sink.path('/tmp/a.png', 'image/png', 100)
      sink.path('/tmp/b.png', 'image/png', 200)
      sink.flush('image.generate', { provider: 'openai', model: 'gpt-image-1' })
    })
    const parsed = JSON.parse(jsonOut.trim())
    expect(parsed.command).toBe('image.generate')
    expect(parsed.data.assets).toHaveLength(2)
    expect(parsed.data.assets[0].path).toBe('/tmp/a.png')
    expect(parsed.meta.provider).toBe('openai')
  })
})

describe('MorphixError.toJSON', () => {
  it('serializes code/message/hint/exitCode', () => {
    const err = new MorphixError('msg', { code: 'E_X', exitCode: 64, hint: 'h' })
    const j = err.toJSON()
    expect(j).toEqual({ code: 'E_X', exitCode: 64, message: 'msg', hint: 'h' })
  })

  it('includes httpStatus for ProviderHttpError', () => {
    const err = new ProviderHttpError('openai', 401)
    const j = err.toJSON()
    expect(j.httpStatus).toBe(401)
    expect(j.exitCode).toBe(70)
  })
})

describe('defaultRunContext', () => {
  it('infers nonInteractive from process.stdin.isTTY', () => {
    // In Vitest stdin is typically not a TTY.
    const ctx = defaultRunContext()
    expect(typeof ctx.nonInteractive).toBe('boolean')
    expect(ctx.json).toBe(false)
    expect(ctx.startMs).toBeLessThanOrEqual(Date.now())
    void vi // keep import
  })
})
