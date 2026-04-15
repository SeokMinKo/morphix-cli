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

  /**
   * Serialize to a stable JSON shape used by the --json envelope. Fields are
   * passed through redact() so any key-shaped substring in the message or
   * hint is masked before hitting the wire.
   */
  toJSON(): { code: string; message: string; hint?: string; exitCode: number; httpStatus?: number } {
    const status = (this as unknown as { status?: number }).status
    return {
      code: this.code,
      message: redact(this.message),
      ...(this.hint ? { hint: redact(this.hint) } : {}),
      exitCode: this.exitCode,
      ...(typeof status === 'number' ? { httpStatus: status } : {}),
    }
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

/**
 * Catalog of every error code the CLI can emit. Surfaced via `mx schema` so
 * agents can reason about error semantics without grepping the source.
 *
 * When adding a new `throw new MorphixError({code:'E_...'})` anywhere,
 * register the code here too.
 */
export interface ErrorCodeSpec {
  code: string
  exitCode: number
  description: string
}

export const ERROR_CODES: ErrorCodeSpec[] = [
  { code: 'E_MORPHIX', exitCode: 1, description: 'Generic Morphix error.' },
  { code: 'E_INTERNAL', exitCode: 1, description: 'Unexpected internal error.' },
  { code: 'E_NO_PROVIDER', exitCode: 64, description: 'No provider resolved for feature.' },
  { code: 'E_NO_MODEL', exitCode: 64, description: 'No model resolved for provider/feature.' },
  { code: 'E_NO_CREDENTIAL', exitCode: 64, description: 'Provider credential missing.' },
  { code: 'E_UNSUPPORTED', exitCode: 64, description: 'Provider does not support capability.' },
  { code: 'E_PROVIDER_HTTP', exitCode: 70, description: 'Upstream provider returned HTTP error (>=500 ⇒ exit 75).' },
  { code: 'E_BAD_SUBCMD', exitCode: 64, description: 'Unknown subcommand.' },
  { code: 'E_BAD_ARGS', exitCode: 64, description: 'Malformed or missing required arguments.' },
  { code: 'E_BAD_PROVIDER', exitCode: 64, description: 'Provider id is not recognized.' },
  { code: 'E_BAD_INPUT', exitCode: 64, description: 'Input file or payload is invalid.' },
  { code: 'E_NO_INPUT', exitCode: 64, description: 'Required input (prompt, file) missing.' },
  { code: 'E_NOT_FOUND', exitCode: 70, description: 'Requested resource (job, file) not found.' },
  { code: 'E_NO_WORKFLOW', exitCode: 64, description: 'ComfyUI workflow not configured.' },
  { code: 'E_BAD_WORKFLOW', exitCode: 64, description: 'ComfyUI workflow JSON failed to parse.' },
  { code: 'E_COMFY_FAILED', exitCode: 70, description: 'ComfyUI reported job failure.' },
  { code: 'E_COMFY_TIMEOUT', exitCode: 75, description: 'ComfyUI job polling timeout.' },
  { code: 'E_JOB_FAILED', exitCode: 70, description: 'Async job (video, music) failed.' },
  { code: 'E_ABORT', exitCode: 130, description: 'Operation aborted by signal.' },
  { code: 'E_INTERACTIVE_REQUIRED', exitCode: 64, description: 'Command needs a TTY or --api-key/--endpoint to run.' },
  { code: 'E_STREAM_REQUIRES_OUT', exitCode: 64, description: 'Binary stream mode incompatible with --json envelope.' },
  { code: 'E_UPDATE_FAILED', exitCode: 70, description: 'Global package update failed.' },
  { code: 'E_QUOTA_UNAVAILABLE', exitCode: 0, description: 'Quota endpoint not available for this provider.' },
]
