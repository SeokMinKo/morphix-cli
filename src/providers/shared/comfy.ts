import { randomUUID } from 'node:crypto'
import { httpJson, httpRequest } from '../../utils/http.js'
import { MorphixError } from '../../utils/errors.js'

/**
 * Minimal ComfyUI REST client. ComfyUI workflows are arbitrary graphs of
 * nodes serialized as JSON ({ <id>: { class_type, inputs } }). This module
 * provides a thin wrapper that:
 *
 *   1. Loads a workflow JSON from disk (optionally substituting $vars).
 *   2. POSTs it to /prompt to queue a job.
 *   3. Polls /history/<prompt_id> until the job finishes.
 *   4. Fetches each output file via /view.
 *
 * ComfyUI's API does not advertise a standard per-modality workflow, so the
 * caller is expected to supply a workflow tailored to their installed
 * custom nodes/models. Built-in templates under `templates/` cover the
 * common cases (SDXL for images) but users will typically override via
 * `--workflow <path>`.
 */

// Using Record<string, any> intentionally — workflow graphs are deeply
// nested with heterogeneous node shapes, so a stricter type would obscure
// more than it helps.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type WorkflowGraph = Record<string, { class_type: string; inputs: Record<string, any> }>

export interface QueueResult {
  prompt_id: string
}

export interface ComfyOutputFile {
  filename: string
  subfolder: string
  type: string // "output" | "temp" | "input"
}

export interface HistoryEntry {
  outputs: Record<
    string,
    {
      images?: ComfyOutputFile[]
      videos?: ComfyOutputFile[]
      gifs?: ComfyOutputFile[]
      audio?: ComfyOutputFile[]
    }
  >
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] }
}

export class ComfyClient {
  readonly endpoint: string
  readonly clientId: string

  constructor(endpoint: string, clientId?: string) {
    this.endpoint = endpoint.replace(/\/$/, '')
    this.clientId = clientId ?? randomUUID()
  }

  /** Queue a workflow. Returns the prompt_id used to poll /history. */
  async queue(graph: WorkflowGraph): Promise<QueueResult> {
    return await httpJson<QueueResult>({
      provider: 'comfyui',
      url: `${this.endpoint}/prompt`,
      json: { prompt: graph, client_id: this.clientId },
    })
  }

  /** Fetch history for a prompt; returns undefined until the server has it. */
  async history(promptId: string): Promise<HistoryEntry | undefined> {
    const all = await httpJson<Record<string, HistoryEntry>>({
      provider: 'comfyui',
      url: `${this.endpoint}/history/${encodeURIComponent(promptId)}`,
      method: 'GET',
    })
    return all[promptId]
  }

  /** Download an output file as raw bytes. */
  async view(file: ComfyOutputFile): Promise<Uint8Array> {
    const params = new URLSearchParams({
      filename: file.filename,
      subfolder: file.subfolder ?? '',
      type: file.type ?? 'output',
    })
    const res = await httpRequest({
      provider: 'comfyui',
      url: `${this.endpoint}/view?${params.toString()}`,
      method: 'GET',
    })
    return new Uint8Array(await res.arrayBuffer())
  }

  /** Poll /history until the job is done. Throws on ComfyUI-reported error. */
  async waitForCompletion(
    promptId: string,
    opts: { pollMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<HistoryEntry> {
    const pollMs = opts.pollMs ?? 1500
    const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : Infinity
    while (true) {
      if (opts.signal?.aborted) throw new MorphixError('Aborted', { code: 'E_ABORT' })
      const entry = await this.history(promptId)
      if (entry) {
        const status = entry.status
        if (status?.completed === false && status.status_str === 'error') {
          throw new MorphixError(`ComfyUI job failed: ${JSON.stringify(status.messages ?? [])}`, {
            code: 'E_COMFY_FAILED',
          })
        }
        if (entry.outputs && Object.keys(entry.outputs).length > 0) return entry
      }
      if (Date.now() >= deadline) {
        throw new MorphixError(`ComfyUI job did not finish within timeout`, {
          code: 'E_COMFY_TIMEOUT',
        })
      }
      await new Promise((r) => setTimeout(r, pollMs))
    }
  }
}

/**
 * Collect every output file (image/video/gif/audio) from a completed
 * history entry, flattened across nodes, in node-key order.
 */
export function collectOutputFiles(entry: HistoryEntry): ComfyOutputFile[] {
  const out: ComfyOutputFile[] = []
  for (const nodeId of Object.keys(entry.outputs).sort()) {
    const node = entry.outputs[nodeId]
    for (const key of ['images', 'videos', 'gifs', 'audio'] as const) {
      const list = node[key]
      if (list) out.push(...list)
    }
  }
  return out
}

/**
 * Substitute `$PROMPT`, `$NEGATIVE`, `$SEED`, `$WIDTH`, `$HEIGHT` placeholders
 * in a workflow JSON string before parsing. Users can author workflow files
 * once and parameterize at runtime. Unknown placeholders are left alone.
 */
export function substituteWorkflow(
  raw: string,
  vars: Record<string, string | number>,
): string {
  return raw.replace(/\$([A-Z_]+)/g, (match, name: string) => {
    const v = vars[name]
    return v === undefined ? match : String(v)
  })
}

/** Load a workflow JSON file, substitute placeholders, and parse it. */
export async function loadWorkflow(
  path: string,
  vars: Record<string, string | number>,
): Promise<WorkflowGraph> {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(path, 'utf8')
  // Escape JSON string literals when substituting: if the placeholder is
  // the value of a JSON string we want quotes preserved. We delegate that
  // to the user — placeholders are raw text substitution, so for string
  // fields they must be written inside quotes: "text": "$PROMPT".
  const escaped: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    escaped[k] = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  }
  const substituted = substituteWorkflow(raw, escaped)
  try {
    return JSON.parse(substituted) as WorkflowGraph
  } catch (e) {
    throw new MorphixError(
      `Failed to parse ComfyUI workflow JSON after substitution: ${(e as Error).message}`,
      { code: 'E_BAD_WORKFLOW', exitCode: 64, hint: `Check ${path}` },
    )
  }
}
