import type { ImageCapability, ImageGenerateInput, ImageGenerateOptions } from '../../capabilities/image.js'
import type { MusicCapability, MusicCoverInput, MusicGenerateInput, MusicGenerateOptions } from '../../capabilities/music.js'
import type {
  VideoCapability,
  VideoGenerateInput,
  VideoGenerateOptions,
} from '../../capabilities/video.js'
import type { Asset, JobStatus } from '../../capabilities/types.js'
import type { ProviderConfig } from '../../config/schema.js'
import { MorphixError } from '../../utils/errors.js'
import { makeProvider, type Provider } from '../base.js'
import {
  ComfyClient,
  collectOutputFiles,
  loadWorkflow,
  type ComfyOutputFile,
  type HistoryEntry,
  type WorkflowGraph,
} from '../shared/comfy.js'
import { defaultImageWorkflow } from './templates.js'

const DEFAULT_ENDPOINT = 'http://localhost:8188'

/**
 * In-process job store so `mx video generate --async` can hand back a
 * prompt_id and a subsequent `mx video poll --job-id <id>` can look up the
 * same ComfyUI endpoint without serializing the full client state. The
 * jobId we return is just the upstream prompt_id, so later poll/fetch
 * calls reconstruct a client from config and query /history directly.
 */
export function createComfyuiProvider(cfg: ProviderConfig): Provider {
  const endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT
  const workflowPath = cfg.extra?.workflow
  const coverWorkflowPath = cfg.extra?.coverWorkflow
  const client = new ComfyClient(endpoint)

  async function runAndCollect(
    graph: WorkflowGraph,
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ files: ComfyOutputFile[]; entry: HistoryEntry }> {
    const { prompt_id } = await client.queue(graph)
    const entry = await client.waitForCompletion(prompt_id, {
      signal: opts.signal,
      timeoutMs: 30 * 60_000,
    })
    return { files: collectOutputFiles(entry), entry }
  }

  async function filesToAssets(
    files: ComfyOutputFile[],
    kind: 'image' | 'video' | 'audio',
  ): Promise<Asset[]> {
    const out: Asset[] = []
    for (const f of files) {
      const bytes = await client.view(f)
      const { mime, ext } = detectMime(f.filename, kind)
      out.push({ kind: kind === 'audio' ? 'audio' : kind, bytes, mime, ext })
    }
    return out
  }

  async function graphForImage(
    input: ImageGenerateInput,
    model: string,
  ): Promise<WorkflowGraph> {
    // Subject refs: when present, upload them and expose SUBJECT_REF /
    // SUBJECT_REF_2 / ... placeholders. The user's workflow JSON decides
    // whether to use them (typically via a LoadImage + IPAdapter chain).
    let subjectVars: Record<string, string | number> = {}
    if (input.subjectRefs && input.subjectRefs.length > 0) {
      const tmpFiles = await writeTempImages(input.subjectRefs)
      const uploaded: string[] = []
      for (const f of tmpFiles) {
        const r = await client.upload(f)
        uploaded.push(r.name)
      }
      subjectVars.SUBJECT_REF = uploaded[0]
      uploaded.forEach((name, i) => {
        if (i > 0) subjectVars[`SUBJECT_REF_${i + 1}`] = name
      })
    }
    if (workflowPath) {
      return loadWorkflow(workflowPath, {
        PROMPT: input.prompt,
        NEGATIVE: '',
        WIDTH: parseAspect(input.aspectRatio ?? input.size ?? '1024x1024').width,
        HEIGHT: parseAspect(input.aspectRatio ?? input.size ?? '1024x1024').height,
        SEED: Math.floor(Math.random() * 2 ** 31),
        ...subjectVars,
      })
    }
    const { width, height } = parseAspect(input.aspectRatio ?? input.size ?? '1024x1024')
    return defaultImageWorkflow({
      prompt: input.prompt,
      width,
      height,
      checkpoint: model.endsWith('.safetensors') ? model : undefined,
    })
  }

  async function writeTempImages(
    refs: NonNullable<ImageGenerateInput['subjectRefs']>,
  ): Promise<string[]> {
    const { tmpdir } = await import('node:os')
    const { writeFile } = await import('node:fs/promises')
    const { join: joinPath } = await import('node:path')
    const out: string[] = []
    for (const ref of refs) {
      const ext = ref.mime === 'image/jpeg' ? 'jpg' : ref.mime === 'image/webp' ? 'webp' : 'png'
      const p = joinPath(tmpdir(), `morphix-subject-${Date.now()}-${out.length}.${ext}`)
      await writeFile(p, ref.bytes)
      out.push(p)
    }
    return out
  }

  const image: ImageCapability = {
    async generate(input: ImageGenerateInput, opts: ImageGenerateOptions) {
      const n = input.n ?? 1
      const assets: Asset[] = []
      for (let i = 0; i < n; i++) {
        const graph = await graphForImage(input, opts.model)
        const { files } = await runAndCollect(graph, { signal: opts.signal })
        assets.push(...(await filesToAssets(files, 'image')))
      }
      return { assets }
    },
  }

  const video: VideoCapability = {
    async submit(input: VideoGenerateInput, _opts: VideoGenerateOptions) {
      if (!workflowPath) {
        throw new MorphixError(
          `ComfyUI video generation requires a workflow file.`,
          {
            code: 'E_NO_WORKFLOW',
            exitCode: 64,
            hint:
              `Set a workflow with one of:\n` +
              `  mx config set --key providers.comfyui.extra.workflow --value /path/to/video.json\n` +
              `  COMFYUI_WORKFLOW=/path/to/video.json mx video generate ...\n` +
              `Authoring guide: https://docs.comfy.org/`,
          },
        )
      }
      const graph = await loadWorkflow(workflowPath, {
        PROMPT: input.prompt,
        DURATION: input.durationSec ?? 4,
        SEED: Math.floor(Math.random() * 2 ** 31),
      })
      const { prompt_id } = await client.queue(graph)
      return { jobId: prompt_id }
    },
    async poll(jobId: string): Promise<JobStatus> {
      const entry = await client.history(jobId)
      if (!entry) return { jobId, state: 'pending' }
      const status = entry.status?.status_str
      if (status === 'error') {
        return { jobId, state: 'error', error: JSON.stringify(entry.status?.messages ?? []) }
      }
      if (entry.outputs && Object.keys(entry.outputs).length > 0) {
        return { jobId, state: 'done' }
      }
      return { jobId, state: 'running' }
    },
    async fetch(jobId: string) {
      const entry = await client.history(jobId)
      if (!entry) throw new MorphixError(`Unknown ComfyUI job: ${jobId}`, { code: 'E_NOT_FOUND' })
      const files = collectOutputFiles(entry)
      return { assets: await filesToAssets(files, 'video') }
    },
  }

  const music: MusicCapability = {
    async generate(input: MusicGenerateInput, _opts: MusicGenerateOptions) {
      if (!workflowPath) {
        throw new MorphixError(
          `ComfyUI music generation requires a workflow file.`,
          {
            code: 'E_NO_WORKFLOW',
            exitCode: 64,
            hint:
              `ComfyUI has no built-in music workflow. Provide one with a model\n` +
              `like ACE-Step or AudioLDM2:\n` +
              `  mx config set --key providers.comfyui.extra.workflow --value /path/to/music.json\n` +
              `Then re-run: mx music generate --prompt "..." --out song.wav`,
          },
        )
      }
      const graph = await loadWorkflow(workflowPath, {
        PROMPT: input.prompt,
        LYRICS: input.lyrics ?? '',
        INSTRUMENTAL: input.instrumental ? '1' : '0',
        DURATION: input.durationSec ?? 30,
        GENRE: input.genre ?? '',
        SEED: Math.floor(Math.random() * 2 ** 31),
      })
      const { files } = await runAndCollect(graph)
      return { kind: 'sync', assets: await filesToAssets(files, 'audio') }
    },
    async cover(input: MusicCoverInput, _opts: MusicGenerateOptions) {
      const wfPath = coverWorkflowPath ?? workflowPath
      if (!wfPath) {
        throw new MorphixError(`ComfyUI music cover requires a workflow file.`, {
          code: 'E_NO_WORKFLOW',
          exitCode: 64,
          hint:
            `Provide an audio→audio (I2A) workflow such as ACE-Step cover:\n` +
            `  mx config set --key providers.comfyui.extra.coverWorkflow --value /path/to/ace-cover.json\n` +
            `Workflow placeholders consumed: $INPUT_AUDIO $STRENGTH $PROMPT $LYRICS $DURATION $SEED`,
        })
      }
      // Upload the source audio so the workflow can reference it by name.
      const uploaded = await client.upload(input.referenceAudioPath)
      const graph = await loadWorkflow(wfPath, {
        INPUT_AUDIO: uploaded.name,
        STRENGTH: input.strength ?? 0.75,
        PROMPT: input.prompt ?? '',
        LYRICS: input.lyrics ?? '',
        DURATION: input.durationSec ?? 0,
        SEED: Math.floor(Math.random() * 2 ** 31),
      })
      const { files } = await runAndCollect(graph)
      return { kind: 'sync', assets: await filesToAssets(files, 'audio') }
    },
  }

  return makeProvider('comfyui', { image, video, music })
}

function parseAspect(spec: string): { width: number; height: number } {
  // Accept WxH, or A:B ratios (default to 1024 area).
  const wh = /^(\d+)x(\d+)$/.exec(spec)
  if (wh) return { width: Number(wh[1]), height: Number(wh[2]) }
  const ab = /^(\d+):(\d+)$/.exec(spec)
  if (ab) {
    const a = Number(ab[1])
    const b = Number(ab[2])
    // Scale to a ~1024 short side, rounded to multiples of 64 (SDXL-friendly).
    const shortSide = 1024
    if (a >= b) {
      const w = Math.round((shortSide * a) / b / 64) * 64
      return { width: w, height: shortSide }
    } else {
      const h = Math.round((shortSide * b) / a / 64) * 64
      return { width: shortSide, height: h }
    }
  }
  return { width: 1024, height: 1024 }
}

function detectMime(
  filename: string,
  kind: 'image' | 'video' | 'audio',
): { mime: string; ext: string } {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const byExt: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    gif: 'image/gif',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
  }
  if (byExt[ext]) return { mime: byExt[ext], ext }
  // Fallbacks by kind
  if (kind === 'image') return { mime: 'image/png', ext: 'png' }
  if (kind === 'video') return { mime: 'video/mp4', ext: 'mp4' }
  return { mime: 'audio/wav', ext: 'wav' }
}
