import { describe, expect, it } from 'vitest'
import { authCommand } from './auth.js'
import { defaultRunContext } from '../utils/envelope.js'
import { MorphixError } from '../utils/errors.js'

describe('auth login (non-interactive)', () => {
  it('throws E_INTERACTIVE_REQUIRED when no --api-key is supplied in non-interactive mode', async () => {
    const ctx = { ...defaultRunContext(), nonInteractive: true, json: true }
    await expect(authCommand(['login', '--provider', 'openai'], ctx)).rejects.toMatchObject({
      code: 'E_INTERACTIVE_REQUIRED',
      exitCode: 64,
    })
  })

  it('rejects unknown provider', async () => {
    const ctx = { ...defaultRunContext(), nonInteractive: true, json: true }
    await expect(authCommand(['login', '--provider', 'bogus'], ctx)).rejects.toBeInstanceOf(
      MorphixError,
    )
  })

  it('requires --provider for login', async () => {
    const ctx = { ...defaultRunContext(), nonInteractive: true, json: true }
    await expect(authCommand(['login'], ctx)).rejects.toMatchObject({ code: 'E_BAD_ARGS' })
  })
})
