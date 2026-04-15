import type { TextChunk } from '../../capabilities/types.js'
import type { TextCapability, TextChatInput, TextChatOptions } from '../../capabilities/text.js'
import type { VisionCapability, VisionDescribeInput, VisionDescribeOptions } from '../../capabilities/vision.js'
import type { ImageCapability, ImageGenerateInput, ImageGenerateOptions } from '../../capabilities/image.js'
import type {
  SpeechCapability,
  SpeechSynthesizeInput,
  SpeechSynthesizeOptions,
} from '../../capabilities/speech.js'
import type { SearchCapability, SearchQueryInput, SearchQueryOptions } from '../../capabilities/search.js'
import type {
  VideoCapability,
  VideoGenerateInput,
  VideoGenerateOptions,
} from '../../capabilities/video.js'
import type { Asset, JobStatus, SearchResult } from '../../capabilities/types.js'
import type { ProviderConfig } from '../../config/schema.js'
import { httpJson, httpRequest } from '../../utils/http.js'
import { iterSse } from '../../utils/sse.js'
import { MorphixError } from '../../utils/errors.js'
import { parsePcmMime, wrapPcmAsWav } from '../../utils/wav.js'
import { makeProvider, type Provider } from '../base.js'
import { readImageRef } from '../shared/imageRef.js'

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com'

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }
    finishReason?: string
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
      webSearchQueries?: string[]
    }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

export function createGeminiProvider(cfg: ProviderConfig): Provider {
  const endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT
  const apiKey = cfg.apiKey ?? ''

  function keyed(url: string): string {
    if (!apiKey) return url
    return url + (url.includes('?') ? '&' : '?') + `key=${encodeURIComponent(apiKey)}`
  }

  function modelUrl(model: string, action: string): string {
    return `${endpoint}/v1beta/models/${encodeURIComponent(model)}:${action}`
  }

  const text: TextCapability = {
    async *chat(input: TextChatInput, opts: TextChatOptions) {
      const contents = input.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))
      const body: Record<string, unknown> = { contents }
      if (input.system) body.systemInstruction = { parts: [{ text: input.system }] }
      const gen: Record<string, unknown> = {}
      if (opts.temperature !== undefined) gen.temperature = opts.temperature
      if (opts.maxTokens !== undefined) gen.maxOutputTokens = opts.maxTokens
      if (Object.keys(gen).length > 0) body.generationConfig = gen

      if (opts.stream === false) {
        const json = (await httpJson({
          provider: 'gemini',
          url: keyed(modelUrl(opts.model, 'generateContent')),
          json: body,
          signal: opts.signal,
        })) as GeminiGenerateResponse
        const txt =
          json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
        yield {
          text: txt,
          done: true,
          usage: json.usageMetadata
            ? {
                inputTokens: json.usageMetadata.promptTokenCount,
                outputTokens: json.usageMetadata.candidatesTokenCount,
                totalTokens: json.usageMetadata.totalTokenCount,
              }
            : undefined,
        }
        return
      }

      const url = keyed(modelUrl(opts.model, 'streamGenerateContent')) + '&alt=sse'
      const res = await httpRequest({
        provider: 'gemini',
        url,
        headers: { accept: 'text/event-stream' },
        json: body,
        signal: opts.signal,
      })

      let inputTokens: number | undefined
      let outputTokens: number | undefined
      for await (const ev of iterSse(res.body)) {
        if (!ev.data) continue
        let parsed: GeminiGenerateResponse
        try {
          parsed = JSON.parse(ev.data) as GeminiGenerateResponse
        } catch {
          continue
        }
        const parts = parsed.candidates?.[0]?.content?.parts ?? []
        for (const p of parts) {
          if (p.text) yield { text: p.text } satisfies TextChunk
        }
        if (parsed.usageMetadata) {
          inputTokens = parsed.usageMetadata.promptTokenCount
          outputTokens = parsed.usageMetadata.candidatesTokenCount
        }
        if (parsed.candidates?.[0]?.finishReason) {
          yield {
            text: '',
            done: true,
            usage:
              inputTokens !== undefined || outputTokens !== undefined
                ? { inputTokens, outputTokens }
                : undefined,
          }
        }
      }
    },
  }

  const vision: VisionCapability = {
    async describe(input: VisionDescribeInput, opts: VisionDescribeOptions) {
      const { bytes, mime } = await readImageRef(input.image)
      const b64 = Buffer.from(bytes).toString('base64')
      const json = (await httpJson({
        provider: 'gemini',
        url: keyed(modelUrl(opts.model, 'generateContent')),
        json: {
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: mime, data: b64 } },
                { text: input.prompt ?? 'Describe this image concisely.' },
              ],
            },
          ],
        },
        signal: opts.signal,
      })) as GeminiGenerateResponse
      const txt =
        json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      return {
        text: txt,
        usage: json.usageMetadata
          ? {
              inputTokens: json.usageMetadata.promptTokenCount,
              outputTokens: json.usageMetadata.candidatesTokenCount,
            }
          : undefined,
      }
    },
  }

  const image: ImageCapability = {
    async generate(input: ImageGenerateInput, opts: ImageGenerateOptions) {
      const hasRefs = !!(input.subjectRefs && input.subjectRefs.length > 0)

      // Imagen models (imagen-3*) use :predict, and support
      // referenceImages[] for subject-conditioned generation.
      if (opts.model.startsWith('imagen-')) {
        // Ensure the prompt includes a [1] reference token when subjectRefs
        // are provided — Imagen requires it to anchor the reference.
        let prompt = input.prompt
        if (hasRefs && !/\[\d+\]/.test(prompt)) {
          prompt = `${prompt} [1]`
        }
        const instance: Record<string, unknown> = { prompt }
        if (hasRefs) {
          instance.referenceImages = input.subjectRefs!.map((ref, i) => ({
            referenceType: 'REFERENCE_TYPE_SUBJECT',
            referenceId: i + 1,
            referenceImage: {
              bytesBase64Encoded: Buffer.from(ref.bytes).toString('base64'),
            },
            subjectImageConfig: {
              subjectType: 'SUBJECT_TYPE_PERSON',
              ...(ref.description ? { subjectDescription: ref.description } : {}),
            },
          }))
        }
        const json = (await httpJson({
          provider: 'gemini',
          url: keyed(modelUrl(opts.model, 'predict')),
          json: {
            instances: [instance],
            parameters: {
              sampleCount: input.n ?? 1,
              aspectRatio: input.aspectRatio ?? '1:1',
            },
          },
          signal: opts.signal,
        })) as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> }
        const assets: Asset[] = (json.predictions ?? []).map((p) => ({
          kind: 'image' as const,
          bytes: p.bytesBase64Encoded ? Buffer.from(p.bytesBase64Encoded, 'base64') : undefined,
          mime: p.mimeType ?? 'image/png',
          ext: (p.mimeType ?? 'image/png').split('/')[1] ?? 'png',
        }))
        return { assets }
      }

      // gemini-*-image-* models go through generateContent with IMAGE modality.
      // Subject refs are sent as inlineData parts alongside the text prompt.
      const userParts: Array<Record<string, unknown>> = []
      if (hasRefs) {
        for (const ref of input.subjectRefs!) {
          userParts.push({
            inlineData: {
              mimeType: ref.mime,
              data: Buffer.from(ref.bytes).toString('base64'),
            },
          })
        }
      }
      userParts.push({ text: input.prompt })
      const json = (await httpJson({
        provider: 'gemini',
        url: keyed(modelUrl(opts.model, 'generateContent')),
        json: {
          contents: [{ role: 'user', parts: userParts }],
          generationConfig: { responseModalities: ['IMAGE'] },
        },
        signal: opts.signal,
      })) as GeminiGenerateResponse
      const parts = json.candidates?.[0]?.content?.parts ?? []
      const assets: Asset[] = []
      for (const p of parts) {
        if (p.inlineData) {
          assets.push({
            kind: 'image',
            bytes: Buffer.from(p.inlineData.data, 'base64'),
            mime: p.inlineData.mimeType,
            ext: (p.inlineData.mimeType.split('/')[1] ?? 'png').split(';')[0],
          })
        }
      }
      return { assets }
    },
  }

  const speech: SpeechCapability = {
    async *synthesize(input: SpeechSynthesizeInput, opts: SpeechSynthesizeOptions) {
      // Gemini TTS returns base64 16-bit PCM at a given sample rate inside
      // the inlineData of a generateContent response. Wrap it in a WAV
      // header so the file is playable everywhere.
      const json = (await httpJson({
        provider: 'gemini',
        url: keyed(modelUrl(opts.model, 'generateContent')),
        json: {
          contents: [{ role: 'user', parts: [{ text: input.text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: input.voice ?? 'Kore' },
              },
            },
          },
        },
        signal: opts.signal,
      })) as GeminiGenerateResponse
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
      if (!part?.inlineData) {
        throw new MorphixError('Gemini TTS returned no audio.', { code: 'E_NO_AUDIO' })
      }
      const pcm = Buffer.from(part.inlineData.data, 'base64')
      const fmt = parsePcmMime(part.inlineData.mimeType)
      const wav = wrapPcmAsWav(new Uint8Array(pcm), fmt)
      yield wav
    },
    async voices() {
      // Gemini TTS exposes a fixed set of voices; list the documented ones.
      return [
        'Zephyr',
        'Puck',
        'Charon',
        'Kore',
        'Fenrir',
        'Leda',
        'Orus',
        'Aoede',
        'Callirhoe',
        'Autonoe',
      ].map((name) => ({ id: name, name }))
    },
  }

  const search: SearchCapability = {
    async query(input: SearchQueryInput, opts: SearchQueryOptions) {
      const model = opts.model ?? 'gemini-2.5-flash'
      const json = (await httpJson({
        provider: 'gemini',
        url: keyed(modelUrl(model, 'generateContent')),
        json: {
          contents: [{ role: 'user', parts: [{ text: input.q }] }],
          tools: [{ google_search: {} }],
        },
        signal: opts.signal,
      })) as GeminiGenerateResponse
      const answer =
        json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') || undefined
      const chunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
      const seen = new Set<string>()
      const results: SearchResult[] = []
      for (const c of chunks) {
        const url = c.web?.uri
        if (!url || seen.has(url)) continue
        seen.add(url)
        results.push({ title: c.web?.title ?? url, url })
      }
      const limited = opts.limit ? results.slice(0, opts.limit) : results
      return { results: limited, answer }
    },
  }

  const video: VideoCapability = {
    async submit(input: VideoGenerateInput, opts: VideoGenerateOptions) {
      const body: Record<string, unknown> = {
        instances: [{ prompt: input.prompt }],
      }
      const params: Record<string, unknown> = {}
      if (input.aspectRatio) params.aspectRatio = input.aspectRatio
      if (input.durationSec) params.durationSeconds = input.durationSec
      if (Object.keys(params).length > 0) body.parameters = params

      const json = (await httpJson({
        provider: 'gemini',
        url: keyed(modelUrl(opts.model, 'predictLongRunning')),
        json: body,
        signal: opts.signal,
      })) as { name?: string }
      if (!json.name) {
        throw new MorphixError('Gemini Veo did not return an operation name.', {
          code: 'E_NO_OPERATION',
        })
      }
      return { jobId: json.name }
    },
    async poll(jobId: string): Promise<JobStatus> {
      // Operation names look like "models/veo-3.0-generate-001/operations/abcd".
      // Accept either the bare name or a leading-slash variant.
      const path = jobId.replace(/^\/+/, '')
      const json = (await httpJson({
        provider: 'gemini',
        url: keyed(`${endpoint}/v1beta/${path}`),
        method: 'GET',
      })) as {
        done?: boolean
        error?: { message?: string }
        metadata?: { progressPercent?: number }
      }
      if (json.error) return { jobId, state: 'error', error: json.error.message }
      if (!json.done) {
        return { jobId, state: 'running', progress: json.metadata?.progressPercent }
      }
      return { jobId, state: 'done' }
    },
    async fetch(jobId: string) {
      const path = jobId.replace(/^\/+/, '')
      const json = (await httpJson({
        provider: 'gemini',
        url: keyed(`${endpoint}/v1beta/${path}`),
        method: 'GET',
      })) as {
        done?: boolean
        response?: {
          generateVideoResponse?: {
            generatedSamples?: Array<{ video?: { uri?: string } }>
          }
        }
      }
      if (!json.done) {
        throw new MorphixError(`Veo job ${jobId} is not done yet`, {
          code: 'E_NOT_READY',
          exitCode: 75,
          hint: `Retry: mx video poll --job-id ${jobId}`,
        })
      }
      const samples = json.response?.generateVideoResponse?.generatedSamples ?? []
      const assets: Asset[] = []
      for (const s of samples) {
        if (!s.video?.uri) continue
        // The URI is fetched with the API key appended.
        const url = s.video.uri + (s.video.uri.includes('?') ? '&' : '?') + `key=${encodeURIComponent(apiKey)}`
        const res = await httpRequest({ provider: 'gemini', url, method: 'GET' })
        const bytes = new Uint8Array(await res.arrayBuffer())
        assets.push({ kind: 'video', bytes, mime: 'video/mp4', ext: 'mp4' })
      }
      return { assets }
    },
  }

  return makeProvider('gemini', { text, vision, image, speech, search, video })
}
