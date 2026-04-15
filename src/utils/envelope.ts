/**
 * Unified output envelope for AI-operability.
 *
 * When `ctx.json` is true, every command emits exactly one JSON line to
 * stdout on success, or exactly one JSON line to stderr on error. Humans
 * continue to see the original plain stdout / formatted stderr output.
 *
 * Envelope shape (success):
 *   { ok:true, command, data, usage?, meta:{provider?, model?, durationMs} }
 *
 * Envelope shape (error):
 *   { ok:false, error:{ code, message, hint?, exitCode, httpStatus? } }
 */
import { MorphixError, redact } from './errors.js'

export interface RunContext {
  /** True when `--json` (or legacy `--format=json` at top level) was passed. */
  json: boolean
  /** True when `--non-interactive` or stdin is not a TTY. */
  nonInteractive: boolean
  /** True when `--quiet` was passed. Suppresses progress-to-stderr writes. */
  quiet: boolean
  /** When the CLI process started. Used to compute meta.durationMs. */
  startMs: number
}

export function defaultRunContext(): RunContext {
  return {
    json: false,
    nonInteractive: !process.stdin.isTTY,
    quiet: false,
    startMs: Date.now(),
  }
}

export interface EnvelopeMeta {
  provider?: string
  model?: string
  [key: string]: unknown
}

export interface SuccessEnvelope {
  ok: true
  command: string
  data: unknown
  usage?: unknown
  meta: EnvelopeMeta & { durationMs: number }
}

export interface ErrorEnvelope {
  ok: false
  error: {
    code: string
    message: string
    hint?: string
    exitCode: number
    httpStatus?: number
  }
}

/**
 * Emit a success envelope as a single JSON line to stdout. No-op in human
 * mode — callers still do their normal console.log / writeBytes output.
 */
export function emitResult(
  ctx: RunContext,
  command: string,
  data: unknown,
  opts: { usage?: unknown; meta?: EnvelopeMeta } = {},
): void {
  if (!ctx.json) return
  const env: SuccessEnvelope = {
    ok: true,
    command,
    data,
    ...(opts.usage !== undefined ? { usage: opts.usage } : {}),
    meta: { ...(opts.meta ?? {}), durationMs: Date.now() - ctx.startMs },
  }
  process.stdout.write(JSON.stringify(env) + '\n')
}

/**
 * Emit an error envelope as a single JSON line to stderr. Always redacts
 * API-key-looking substrings in message/hint. Returns the exit code so the
 * caller can `process.exit(code)` consistently.
 */
export function emitError(ctx: RunContext, err: unknown): number {
  if (err instanceof MorphixError) {
    const status = (err as unknown as { status?: number }).status
    const env: ErrorEnvelope = {
      ok: false,
      error: {
        code: err.code,
        message: redact(err.message),
        ...(err.hint ? { hint: redact(err.hint) } : {}),
        exitCode: err.exitCode,
        ...(typeof status === 'number' ? { httpStatus: status } : {}),
      },
    }
    if (ctx.json) process.stderr.write(JSON.stringify(env) + '\n')
    return err.exitCode
  }
  const message = err instanceof Error ? err.message : String(err)
  const env: ErrorEnvelope = {
    ok: false,
    error: {
      code: 'E_INTERNAL',
      message: redact(message),
      exitCode: 1,
    },
  }
  if (ctx.json) process.stderr.write(JSON.stringify(env) + '\n')
  return 1
}

/**
 * Helper for commands that want both behaviors: a text line to stdout in
 * human mode, or an entry accumulated for later `emitResult`.
 *
 * Usage pattern:
 *   const sink = new AssetSink(ctx)
 *   sink.path(savedPath, 'image/png', bytes.length)
 *   sink.flush('image.generate', { provider, model })
 */
export interface AssetRecord {
  path?: string
  url?: string
  mime?: string
  bytes?: number
  kind?: string
}

export class AssetSink {
  private items: AssetRecord[] = []
  constructor(private ctx: RunContext) {}

  path(p: string, mime?: string, bytes?: number, kind?: string): void {
    if (this.ctx.json) this.items.push({ path: p, mime, bytes, kind })
    else process.stdout.write(p + '\n')
  }

  url(u: string, mime?: string, kind?: string): void {
    if (this.ctx.json) this.items.push({ url: u, mime, kind })
    else process.stdout.write(u + '\n')
  }

  collect(): AssetRecord[] {
    return this.items
  }

  flush(command: string, meta?: EnvelopeMeta, usage?: unknown): void {
    if (!this.ctx.json) return
    emitResult(this.ctx, command, { assets: this.items }, { usage, meta })
  }
}
