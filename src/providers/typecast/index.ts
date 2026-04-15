import type {
  SpeechCapability,
  SpeechSynthesizeInput,
  SpeechSynthesizeOptions,
} from '../../capabilities/speech.js'
import type { ProviderConfig } from '../../config/schema.js'
import { httpJson, httpRequest } from '../../utils/http.js'
import { MorphixError } from '../../utils/errors.js'
import { makeProvider, type Provider } from '../base.js'

const DEFAULT_ENDPOINT = 'https://typecast.ai'
const POLL_BACKOFF_MS = [1_000, 2_000, 4_000]
const POLL_TIMEOUT_MS = 2 * 60_000

/**
 * Typecast (https://typecast.ai) — Korean-first AI voice / TTS service. The
 * public API is batch-oriented:
 *
 *   1. POST /api/speak               { text, actor_id, ... } → { result: { speak_v2_url } }
 *   2. GET  {speak_v2_url}            → { result: { status, audio_download_url? } }
 *   3. GET  {audio_download_url}      → mp3 / wav bytes
 *
 * Morphix's SpeechCapability is an AsyncIterable<Uint8Array>, so we wait for
 * the job to finish and then stream the download response out chunk-by-chunk
 * (same pattern as the OpenAI speech provider).
 *
 * Voice selection falls back through: input.voice → cfg.extra.actorId →
 * opts.model. This lets users pin a default actor via either the `--model`
 * flag or `providers.typecast.extra.actorId` in config.
 */
interface SpeakResponse {
  result?: {
    speak_v2_url?: string
  }
}

interface SpeakStatusResponse {
  result?: {
    status?: 'progress' | 'started' | 'done' | 'failed'
    audio_download_url?: string
  }
}

export function createTypecastProvider(cfg: ProviderConfig): Provider {
  const endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT
  const apiKey = cfg.apiKey ?? ''
  const defaultActor = cfg.extra?.actorId

  function authHeaders(): Record<string, string> {
    if (!apiKey) {
      throw new MorphixError(`No credential found for provider 'typecast'.`, {
        code: 'E_NO_CREDENTIAL',
        exitCode: 64,
        hint:
          `Set the TYPECAST_API_KEY env var or run:\n` +
          `  mx auth login --provider typecast`,
      })
    }
    return { authorization: `Bearer ${apiKey}` }
  }

  function resolveActor(input: SpeechSynthesizeInput, opts: SpeechSynthesizeOptions): string {
    const actor = input.voice ?? defaultActor ?? opts.model
    if (!actor) {
      throw new MorphixError(`Typecast requires an actor_id (voice).`, {
        code: 'E_NO_MODEL',
        exitCode: 64,
        hint:
          `Pass it as --voice <actor_id> / --model <actor_id>, set TYPECAST_ACTOR_ID, or run:\n` +
          `  mx config set --key providers.typecast.extra.actorId --value <actor_id>\n` +
          `Browse voices at https://typecast.ai/`,
      })
    }
    return actor
  }

  async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError()
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(t)
        reject(abortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  function abortError(): MorphixError {
    return new MorphixError('Operation aborted.', { code: 'E_ABORT', exitCode: 130 })
  }

  async function waitForAudio(speakUrl: string, signal?: AbortSignal): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let i = 0
    while (Date.now() < deadline) {
      const res = (await httpJson({
        provider: 'typecast',
        url: speakUrl,
        method: 'GET',
        headers: authHeaders(),
        signal,
      })) as SpeakStatusResponse
      const status = res.result?.status
      if (status === 'done' && res.result?.audio_download_url) {
        return res.result.audio_download_url
      }
      if (status === 'failed') {
        throw new MorphixError(`Typecast synthesis failed.`, {
          code: 'E_JOB_FAILED',
          exitCode: 70,
        })
      }
      const wait = POLL_BACKOFF_MS[Math.min(i, POLL_BACKOFF_MS.length - 1)]
      await sleep(wait, signal)
      i++
    }
    throw new MorphixError(`Typecast synthesis timed out after ${POLL_TIMEOUT_MS / 1000}s.`, {
      code: 'E_JOB_FAILED',
      exitCode: 75,
    })
  }

  const speech: SpeechCapability = {
    async *synthesize(input: SpeechSynthesizeInput, opts: SpeechSynthesizeOptions) {
      const actor = resolveActor(input, opts)
      const body: Record<string, unknown> = {
        text: input.text,
        lang: 'auto',
        actor_id: actor,
        xapi_hd: true,
        model_version: 'latest',
        tempo: input.speed ?? 1,
        pitch: input.pitch ?? 0,
        volume: 100,
      }
      if (opts.format) body.audio_format = opts.format
      const submit = (await httpJson({
        provider: 'typecast',
        url: `${endpoint}/api/speak`,
        headers: authHeaders(),
        json: body,
        signal: opts.signal,
      })) as SpeakResponse
      const speakUrl = submit.result?.speak_v2_url
      if (!speakUrl) {
        throw new MorphixError(`Typecast did not return a speak_v2_url.`, {
          code: 'E_PROVIDER_HTTP',
          exitCode: 70,
        })
      }
      const audioUrl = await waitForAudio(speakUrl, opts.signal)
      const res = await httpRequest({
        provider: 'typecast',
        url: audioUrl,
        method: 'GET',
        signal: opts.signal,
      })
      if (!res.body) {
        yield new Uint8Array(await res.arrayBuffer())
        return
      }
      const reader = res.body.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) yield value
        }
      } finally {
        reader.releaseLock()
      }
    },
  }

  return makeProvider('typecast', { speech })
}
