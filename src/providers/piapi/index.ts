import type { ImageCapability, ImageGenerateInput, ImageGenerateOptions } from '../../capabilities/image.js'
import type { MusicCapability, MusicGenerateInput, MusicGenerateOptions } from '../../capabilities/music.js'
import type {
  VideoCapability,
  VideoGenerateInput,
  VideoGenerateOptions,
} from '../../capabilities/video.js'
import type { Asset, JobStatus } from '../../capabilities/types.js'
import type { Capability, ProviderConfig } from '../../config/schema.js'
import { httpJson, httpRequest } from '../../utils/http.js'
import { MorphixError } from '../../utils/errors.js'
import { makeProvider, type Provider } from '../base.js'

const DEFAULT_ENDPOINT = 'https://api.piapi.ai'
const POLL_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000]
const POLL_TIMEOUT_MS = 5 * 60_000

/**
 * PiAPI Unified API — a single `/api/v1/task` surface that proxies Midjourney,
 * Flux, Kling, Hailuo, Luma, Suno (via `music-u`), Udio, and friends. Each
 * request specifies a (model, task_type) pair; results arrive via polling.
 *
 * Morphix maps this onto three capabilities:
 *   - image: sync facade (internal polling until `completed`)
 *   - video: async (submit/poll/fetch) — PiAPI task_id IS the jobId
 *   - music: async (returns { kind:'async', jobId }) — matches the music cap
 *     contract so downstream `mx music poll/fetch` works unchanged
 */
const MODEL_TABLE: Record<string, { cap: Capability; taskType: string }> = {
  'Qubico/flux1-schnell': { cap: 'image', taskType: 'txt2img' },
  'Qubico/flux1-dev': { cap: 'image', taskType: 'txt2img' },
  'Qubico/flux1-dev-advanced': { cap: 'image', taskType: 'txt2img' },
  midjourney: { cap: 'image', taskType: 'imagine' },
  kling: { cap: 'video', taskType: 'video_generation' },
  hailuo: { cap: 'video', taskType: 'video_generation' },
  luma: { cap: 'video', taskType: 'video_generation' },
  'Qubico/wanx': { cap: 'video', taskType: 'video_generation' },
  'music-u': { cap: 'music', taskType: 'generate_music' },
  'music-s': { cap: 'music', taskType: 'generate_music' },
  'Qubico/diffrhythm': { cap: 'music', taskType: 'txt2audio-base' },
}

interface TaskResponse {
  code: number
  message?: string
  data?: {
    task_id?: string
    status?: 'pending' | 'processing' | 'completed' | 'failed'
    output?: unknown
    error?: { code?: number; message?: string; raw_message?: string }
  }
}

export function createPiapiProvider(cfg: ProviderConfig): Provider {
  const endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT
  const apiKey = cfg.apiKey ?? ''
  const extraTaskType = cfg.extra?.taskType

  function authHeaders(): Record<string, string> {
    if (!apiKey) {
      throw new MorphixError(`No credential found for provider 'piapi'.`, {
        code: 'E_NO_CREDENTIAL',
        exitCode: 64,
        hint:
          `Set the PIAPI_API_KEY env var or run:\n` +
          `  mx auth login --provider piapi`,
      })
    }
    return { 'x-api-key': apiKey }
  }

  function resolveTaskType(model: string, cap: Capability): string {
    if (extraTaskType) return extraTaskType
    const entry = MODEL_TABLE[model]
    if (entry) return entry.taskType
    // Prefix fallback — Qubico model families tend to follow conventions.
    if (cap === 'image') return 'txt2img'
    if (cap === 'video') return 'video_generation'
    if (cap === 'music') return 'generate_music'
    throw new MorphixError(`Cannot infer PiAPI task_type for model '${model}'.`, {
      code: 'E_BAD_ARGS',
      exitCode: 64,
      hint:
        `Set it explicitly:\n` +
        `  mx config set --key providers.piapi.extra.taskType --value <task_type>\n` +
        `  PIAPI_TASK_TYPE=<task_type> mx ...`,
    })
  }

  async function submitTask(
    model: string,
    taskType: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const body = { model, task_type: taskType, input }
    const res = (await httpJson({
      provider: 'piapi',
      url: `${endpoint}/api/v1/task`,
      headers: authHeaders(),
      json: body,
      signal,
    })) as TaskResponse
    if (res.code !== 200 || !res.data?.task_id) {
      throw new MorphixError(
        `PiAPI rejected task submission: ${res.message ?? 'unknown error'}`,
        { code: 'E_PROVIDER_HTTP', exitCode: 70 },
      )
    }
    return res.data.task_id
  }

  async function getTask(taskId: string, signal?: AbortSignal): Promise<TaskResponse['data']> {
    const res = (await httpJson({
      provider: 'piapi',
      url: `${endpoint}/api/v1/task/${encodeURIComponent(taskId)}`,
      method: 'GET',
      headers: authHeaders(),
      signal,
    })) as TaskResponse
    if (res.code !== 200 || !res.data) {
      throw new MorphixError(
        `PiAPI task lookup failed: ${res.message ?? 'unknown error'}`,
        { code: 'E_PROVIDER_HTTP', exitCode: 70 },
      )
    }
    return res.data
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

  async function pollUntilDone(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<NonNullable<TaskResponse['data']>> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let i = 0
    while (Date.now() < deadline) {
      const data = await getTask(taskId, signal)
      if (!data) throw new MorphixError(`PiAPI task ${taskId} has no data.`, { code: 'E_NOT_FOUND' })
      if (data.status === 'completed') return data
      if (data.status === 'failed') {
        throw new MorphixError(
          `PiAPI task failed: ${data.error?.message ?? data.error?.raw_message ?? 'unknown'}`,
          { code: 'E_JOB_FAILED', exitCode: 70 },
        )
      }
      const wait = POLL_BACKOFF_MS[Math.min(i, POLL_BACKOFF_MS.length - 1)]
      await sleep(wait, signal)
      i++
    }
    throw new MorphixError(`PiAPI task ${taskId} timed out after ${POLL_TIMEOUT_MS / 1000}s.`, {
      code: 'E_JOB_FAILED',
      exitCode: 75,
      hint: `Check status: mx video poll --job-id ${taskId}`,
    })
  }

  /** Extract downloadable URLs from the many output shapes PiAPI emits. */
  function extractUrls(output: unknown): string[] {
    if (!output || typeof output !== 'object') return []
    const o = output as Record<string, unknown>
    const out: string[] = []
    const push = (v: unknown) => {
      if (typeof v === 'string' && v) out.push(v)
    }
    push(o.image_url)
    push(o.video_url)
    push(o.audio_url)
    push(o.song_path)
    push(o.url)
    if (Array.isArray(o.image_urls)) for (const u of o.image_urls) push(u)
    if (Array.isArray(o.videos)) {
      for (const v of o.videos) {
        if (v && typeof v === 'object') {
          const vv = v as Record<string, unknown>
          push(vv.url)
          push(vv.resource_without_watermark)
          push(vv.resource)
        }
      }
    }
    if (Array.isArray(o.works)) {
      for (const w of o.works) {
        if (!w || typeof w !== 'object') continue
        const ww = w as Record<string, unknown>
        const video = ww.video as Record<string, unknown> | undefined
        if (video) {
          push(video.resource_without_watermark)
          push(video.resource)
          push(video.url)
        }
        const cover = ww.cover as Record<string, unknown> | undefined
        if (cover) push(cover.resource)
      }
    }
    if (Array.isArray(o.songs)) {
      for (const s of o.songs) {
        if (s && typeof s === 'object') {
          const ss = s as Record<string, unknown>
          push(ss.song_path)
          push(ss.url)
        }
      }
    }
    return out
  }

  async function urlsToAssets(
    urls: string[],
    kind: 'image' | 'video' | 'audio',
    signal?: AbortSignal,
  ): Promise<Asset[]> {
    const assets: Asset[] = []
    for (const url of urls) {
      const res = await httpRequest({ provider: 'piapi', url, method: 'GET', signal })
      const bytes = new Uint8Array(await res.arrayBuffer())
      const { mime, ext } = detectMime(url, kind)
      assets.push({ kind, bytes, mime, ext, url })
    }
    return assets
  }

  const image: ImageCapability = {
    async generate(input: ImageGenerateInput, opts: ImageGenerateOptions) {
      const taskType = resolveTaskType(opts.model, 'image')
      const n = input.n ?? 1
      const taskInput: Record<string, unknown> = { prompt: input.prompt }
      if (input.aspectRatio) taskInput.aspect_ratio = input.aspectRatio
      if (input.size) taskInput.size = input.size
      if (taskType === 'imagine' && n > 1) {
        // Midjourney returns a 4-image grid per task; request multiple tasks.
      }
      const assets: Asset[] = []
      for (let i = 0; i < n; i++) {
        const taskId = await submitTask(opts.model, taskType, taskInput, opts.signal)
        const data = await pollUntilDone(taskId, opts.signal)
        const urls = extractUrls(data.output)
        if (urls.length === 0) {
          throw new MorphixError(
            `PiAPI task ${taskId} completed but returned no downloadable asset.`,
            { code: 'E_JOB_FAILED', exitCode: 70 },
          )
        }
        assets.push(...(await urlsToAssets(urls, 'image', opts.signal)))
      }
      return { assets }
    },
  }

  const video: VideoCapability = {
    async submit(input: VideoGenerateInput, opts: VideoGenerateOptions) {
      const taskType = resolveTaskType(opts.model, 'video')
      const taskInput: Record<string, unknown> = { prompt: input.prompt }
      if (input.durationSec) taskInput.duration = input.durationSec
      if (input.aspectRatio) taskInput.aspect_ratio = input.aspectRatio
      const taskId = await submitTask(opts.model, taskType, taskInput, opts.signal)
      return { jobId: taskId }
    },
    async poll(jobId: string): Promise<JobStatus> {
      const data = await getTask(jobId)
      if (!data) return { jobId, state: 'pending' }
      if (data.status === 'failed') {
        return {
          jobId,
          state: 'error',
          error: data.error?.message ?? data.error?.raw_message,
        }
      }
      if (data.status === 'completed') return { jobId, state: 'done' }
      if (data.status === 'processing') return { jobId, state: 'running' }
      return { jobId, state: 'pending' }
    },
    async fetch(jobId: string) {
      const data = await getTask(jobId)
      if (!data) throw new MorphixError(`Unknown PiAPI task: ${jobId}`, { code: 'E_NOT_FOUND' })
      if (data.status !== 'completed') {
        throw new MorphixError(`PiAPI task ${jobId} is not done yet (status=${data.status}).`, {
          code: 'E_NOT_READY',
          exitCode: 75,
          hint: `Retry: mx video poll --job-id ${jobId}`,
        })
      }
      const urls = extractUrls(data.output)
      return { assets: await urlsToAssets(urls, 'video') }
    },
  }

  const music: MusicCapability = {
    async generate(input: MusicGenerateInput, opts: MusicGenerateOptions) {
      const taskType = resolveTaskType(opts.model, 'music')
      const taskInput: Record<string, unknown> = {
        prompt: input.prompt,
        gpt_description_prompt: input.prompt,
      }
      if (input.lyrics) taskInput.lyrics = input.lyrics
      if (input.instrumental) taskInput.make_instrumental = true
      if (input.durationSec) taskInput.duration = input.durationSec
      if (input.genre) taskInput.tags = input.genre
      const taskId = await submitTask(opts.model, taskType, taskInput, opts.signal)
      return { kind: 'async', jobId: taskId }
    },
  }

  return makeProvider('piapi', { image, video, music })
}

/** Guess MIME + extension from a URL path. Mirrors comfyui's detectMime. */
function detectMime(
  urlOrName: string,
  kind: 'image' | 'video' | 'audio',
): { mime: string; ext: string } {
  const path = urlOrName.split('?')[0]
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const byExt: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
  }
  if (byExt[ext]) return { mime: byExt[ext], ext }
  if (kind === 'image') return { mime: 'image/png', ext: 'png' }
  if (kind === 'video') return { mime: 'video/mp4', ext: 'mp4' }
  return { mime: 'audio/mpeg', ext: 'mp3' }
}
