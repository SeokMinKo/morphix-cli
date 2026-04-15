/**
 * Typed errors with actionable hints. Thrown errors that extend MorphixError
 * will be pretty-printed by the top-level CLI handler and exit with the
 * error's declared exit code. Every error carries an optional `hint` so we
 * can tell the user exactly which command to run to fix the issue.
 */
export class MorphixError extends Error {
  readonly hint?: string
  readonly exitCode: number
  readonly code: string

  constructor(message: string, opts: { hint?: string; exitCode?: number; code?: string } = {}) {
    super(message)
    this.name = 'MorphixError'
    this.hint = opts.hint
    this.exitCode = opts.exitCode ?? 1
    this.code = opts.code ?? 'E_MORPHIX'
  }
}

export class MissingProviderError extends MorphixError {
  constructor(feature: string) {
    super(`No provider configured for '${feature}'.`, {
      code: 'E_NO_PROVIDER',
      exitCode: 64,
      hint:
        `Pass --provider <id>, set MORPHIX_${feature.toUpperCase()}_PROVIDER, or run:\n` +
        `  mx config set --key defaults.${feature}.provider --value <anthropic|openai|gemini|ollama|comfyui>`,
    })
  }
}

export class MissingModelError extends MorphixError {
  constructor(feature: string, provider: string) {
    super(`No model configured for '${feature}' on provider '${provider}'.`, {
      code: 'E_NO_MODEL',
      exitCode: 64,
      hint:
        `Pass --model <name>, set MORPHIX_${feature.toUpperCase()}_MODEL, or run:\n` +
        `  mx config set --key defaults.${feature}.model --value <model>`,
    })
  }
}

export class MissingCredentialError extends MorphixError {
  constructor(provider: string, envName: string) {
    super(`No credential found for provider '${provider}'.`, {
      code: 'E_NO_CREDENTIAL',
      exitCode: 64,
      hint:
        `Set the ${envName} env var or run:\n` +
        `  mx auth login --provider ${provider}`,
    })
  }
}

export class UnsupportedCapabilityError extends MorphixError {
  constructor(provider: string, capability: string, validProviders: string[]) {
    const alt = validProviders.length
      ? `Providers that support '${capability}': ${validProviders.join(', ')}`
      : `No configured provider supports '${capability}' yet.`
    super(`Provider '${provider}' does not support '${capability}'.`, {
      code: 'E_UNSUPPORTED',
      exitCode: 64,
      hint: alt + `\n  Retry with: --provider <one of the above>`,
    })
  }
}

export class ProviderHttpError extends MorphixError {
  readonly status: number
  readonly body?: string
  constructor(provider: string, status: number, body?: string) {
    super(`${provider} API returned HTTP ${status}${body ? `: ${truncate(body, 300)}` : ''}`, {
      code: 'E_PROVIDER_HTTP',
      exitCode: status >= 500 ? 75 : 70,
    })
    this.status = status
    this.body = body
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + '…'
}

/**
 * Format an error for human display. Includes the hint on a following line.
 * Redacts anything that looks like an API key in the message/hint.
 */
export function formatError(err: MorphixError): string {
  const lines: string[] = [`Error: ${redact(err.message)}`]
  if (err.hint) {
    for (const line of err.hint.split('\n')) {
      lines.push(`  ${redact(line)}`)
    }
  }
  return lines.join('\n')
}

const KEY_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_\-]{8,}/g, // Anthropic
  /sk-[A-Za-z0-9_\-]{20,}/g, // OpenAI
  /AIza[A-Za-z0-9_\-]{20,}/g, // Google
  /Bearer\s+[A-Za-z0-9_\-.]{12,}/g,
]

/** Redact anything that looks like a secret. Used defensively in all error output. */
export function redact(s: string): string {
  let out = s
  for (const pat of KEY_PATTERNS) {
    out = out.replace(pat, (m) => (m.length > 8 ? m.slice(0, 4) + '…' + m.slice(-4) : '…'))
  }
  return out
}
